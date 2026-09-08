/**
 * Use-cases for `inventory`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 *
 * **The invariant this module exists to hold (§3/§7):** `websiteStock` is never
 * mutated except by {@link applyMovement}, which takes the branded `Tx`, locks
 * the row, and writes exactly one `StockLedger` entry whose `balanceAfter` is
 * the balance it just wrote. There is deliberately no other path to the column.
 */
import {
  assertAuthorized,
  AuthzError,
  emit,
  NotFoundError,
  withTransaction,
  writeAuditLog,
  type Principal,
  type Tx,
} from '../platform/index';
import {
  availabilityOf,
  crossedLowThresholdDownward,
  descriptor,
  displayableRemaining,
  isLow,
  nextBalance,
  reconcileDelta,
  LOW_STOCK_DISPLAY_THRESHOLD,
  type Availability,
  type ModuleDescriptor,
  type StockReason,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type { InventoryRecord, LedgerQuery, LedgerRecord } from './repo';

/** What one applied movement did, for the caller to report and emit from. */
export interface MovementResult {
  readonly storeId: string;
  readonly productId: string;
  readonly delta: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly ledgerId: string;
  readonly crossedLow: boolean;
}

export interface MovementInput {
  readonly storeId: string;
  readonly productId: string;
  readonly delta: number;
  readonly reason: StockReason;
  readonly note?: string | null;
  readonly refType?: string | null;
  readonly refId?: string | null;
  /** Set on a reconcile, so the admin screen can show when it was last counted. */
  readonly countedAt?: Date;
}

function actorOf(principal: Principal): {
  actorType: 'USER' | 'CUSTOMER' | 'SYSTEM';
  actorId: string | null;
} {
  switch (principal.kind) {
    case 'user':
      return { actorType: 'USER', actorId: principal.userId };
    case 'customer':
      return { actorType: 'CUSTOMER', actorId: principal.customerId };
    case 'system':
      return { actorType: 'SYSTEM', actorId: null };
  }
}

/**
 * The **only** way `websiteStock` changes. Exported so Phase 4/5 (order
 * placement, short-pick restore, admin correction, POS sync) call this rather
 * than writing the column themselves.
 *
 * Requires a `Tx` and does four things inside it, in this order:
 *
 * 1. `SELECT … FOR UPDATE` the item, so a concurrent adjust/import/reconcile on
 *    the same row waits rather than reading a balance that is about to change;
 * 2. compute the new balance and refuse a negative one *before* writing;
 * 3. update `websiteStock`;
 * 4. append one `StockLedger` row whose `balanceAfter` is that balance.
 *
 * If anything after step 1 throws, the whole transaction rolls back and neither
 * the stock nor the ledger moved — which is the only way the two can be
 * guaranteed to agree.
 */
export async function applyMovement(
  tx: Tx,
  principal: Principal,
  input: MovementInput,
): Promise<MovementResult> {
  // Create on first touch so a product that has never been stocked can be
  // adjusted; the lock is taken after, on a row that now certainly exists.
  await repo.ensureItem(tx, input.storeId, input.productId);

  const locked = await repo.lockItem(tx, input.storeId, input.productId);
  if (locked === null) {
    throw new NotFoundError('No inventory row for that store and product', {
      storeId: input.storeId,
      productId: input.productId,
    });
  }

  const balanceBefore = locked.websiteStock;
  const balanceAfter = nextBalance(balanceBefore, input.delta);

  const item = await repo.setStock(tx, locked.id, balanceAfter, input.countedAt);

  const { actorType, actorId } = actorOf(principal);
  const ledger = await repo.insertLedger(tx, {
    storeId: input.storeId,
    productId: input.productId,
    delta: input.delta,
    reason: input.reason,
    balanceAfter: item.websiteStock,
    actorType,
    actorId,
    refType: input.refType ?? null,
    refId: input.refId ?? null,
    note: input.note ?? null,
  });

  const threshold = await repo.lowStockThresholdFor(input.storeId, tx);

  return {
    storeId: input.storeId,
    productId: input.productId,
    delta: input.delta,
    balanceBefore,
    balanceAfter: item.websiteStock,
    ledgerId: ledger.id,
    crossedLow: crossedLowThresholdDownward(balanceBefore, item.websiteStock, threshold),
  };
}

/**
 * Announce a movement after its transaction has committed.
 *
 * Events fire *outside* the transaction on purpose: a handler must not be able
 * to roll back a stock change that already succeeded, and it must not observe a
 * balance that is about to disappear.
 */
export function announceMovement(result: MovementResult): void {
  emit('stock.changed', {
    storeId: result.storeId,
    productId: result.productId,
    balanceAfter: result.balanceAfter,
  });
  // Only the downward *crossing*, not every movement that happens to sit below
  // the line — otherwise the alert stops meaning anything.
  if (result.crossedLow) {
    emit('stock.low', {
      storeId: result.storeId,
      productId: result.productId,
      balanceAfter: result.balanceAfter,
    });
  }
}

// ---------------------------------------------------------------------------
// Admin operations
// ---------------------------------------------------------------------------

/** Add or subtract stock by a signed amount. */
export async function adjustStock(
  principal: Principal,
  input: { storeId: string; productId: string; delta: number; note?: string | null },
): Promise<MovementResult> {
  assertAuthorized(principal, 'inventory:adjust', {
    type: 'InventoryItem',
    storeId: input.storeId,
  });

  const result = await withTransaction(async (tx) => {
    const movement = await applyMovement(tx, principal, {
      storeId: input.storeId,
      productId: input.productId,
      delta: input.delta,
      reason: 'MANUAL_ADJUST',
      note: input.note ?? null,
    });
    await writeAuditLog(tx, {
      principal,
      action: 'adjust',
      entityType: 'InventoryItem',
      entityId: `${input.storeId}:${input.productId}`,
      storeId: input.storeId,
      before: { websiteStock: movement.balanceBefore },
      after: { websiteStock: movement.balanceAfter, delta: movement.delta },
    });
    return movement;
  });

  announceMovement(result);
  return result;
}

/**
 * Set stock to a counted quantity. The ledger records the *difference*, because
 * "the shelf count said 12" is only useful next to what the system thought.
 */
export async function reconcileStock(
  principal: Principal,
  input: { storeId: string; productId: string; counted: number; note?: string | null },
): Promise<MovementResult | null> {
  assertAuthorized(principal, 'inventory:reconcile', {
    type: 'InventoryItem',
    storeId: input.storeId,
  });

  const now = new Date();
  const outcome = await withTransaction(async (tx) => {
    await repo.ensureItem(tx, input.storeId, input.productId);
    const locked = await repo.lockItem(tx, input.storeId, input.productId);
    if (locked === null) {
      throw new NotFoundError('No inventory row for that store and product', { ...input });
    }

    const delta = reconcileDelta(locked.websiteStock, input.counted);
    if (delta === 0) {
      // The count agreed. Record *when* it was counted; a zero-delta ledger row
      // would be noise in the movement history.
      await repo.setStock(tx, locked.id, locked.websiteStock, now);
      await writeAuditLog(tx, {
        principal,
        action: 'reconcile',
        entityType: 'InventoryItem',
        entityId: `${input.storeId}:${input.productId}`,
        // Stamped like every other branch: R3 filters audit visibility by this
        // column in SQL, so an unstamped entry is invisible to the very manager
        // who did the count.
        storeId: input.storeId,
        before: { websiteStock: locked.websiteStock },
        after: { websiteStock: locked.websiteStock, counted: input.counted, delta: 0 },
      });
      return null;
    }

    const movement = await applyMovement(tx, principal, {
      storeId: input.storeId,
      productId: input.productId,
      delta,
      reason: 'RECONCILE',
      note: input.note ?? `Counted ${input.counted}`,
      countedAt: now,
    });
    await writeAuditLog(tx, {
      principal,
      action: 'reconcile',
      entityType: 'InventoryItem',
      entityId: `${input.storeId}:${input.productId}`,
      storeId: input.storeId,
      before: { websiteStock: movement.balanceBefore },
      after: { websiteStock: movement.balanceAfter, counted: input.counted, delta },
    });
    return movement;
  });

  if (outcome !== null) announceMovement(outcome);
  return outcome;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listStock(
  principal: Principal,
  options: { storeId?: string; productIds?: readonly string[]; limit?: number } = {},
): Promise<readonly repo.InventoryRecord[]> {
  assertAuthorized(principal, 'inventory:read', {
    type: 'InventoryItem',
    storeId: options.storeId ?? scopeOf(principal),
  });
  refuseCustomer(principal);
  return repo.listItems(principal, options);
}

/**
 * Refuse a shopper a raw balance.
 *
 * The grant table says a customer may read their store's inventory; this says
 * *in what shape*. `listStock` and `getStock` return `websiteStock` itself,
 * which is a live inventory feed — the storefront gets {@link availabilityFor}
 * instead, and the difference is enforced here rather than trusted to whoever
 * writes the next page.
 */
function refuseCustomer(principal: Principal): void {
  if (principal.kind === 'customer') {
    throw new AuthzError('You do not have permission to perform this action', {
      resourceType: 'InventoryItem',
      reason: 'a storefront reads availability bands, never raw stock',
    });
  }
}

/** A specific quantity, checked against the shelf. */
export interface StockCheck {
  readonly productId: string;
  readonly requested: number;
  readonly available: number;
  readonly sufficient: boolean;
}

/**
 * Can this store supply these quantities right now?
 *
 * The exact balance *is* returned here, unlike {@link availabilityFor} — because
 * the question is "you asked for 12, can I have them?", and the honest answer to
 * that is "only 8 left". The disclosure is bounded by the shopper having asked
 * about a specific product and quantity, rather than being published on a page
 * anyone can scrape.
 *
 * This is a **read**. Nothing here reserves, holds or decrements anything: a
 * cart is not a claim on stock, and the only place a balance may move is
 * `applyMovement` (§3/§7). Two shoppers may hold the last unit in their carts,
 * and Phase 4's checkout is where that is resolved under a row lock.
 */
export async function checkAvailability(
  principal: Principal,
  storeId: string,
  requests: readonly { productId: string; qty: number }[],
): Promise<ReadonlyMap<string, StockCheck>> {
  assertAuthorized(principal, 'inventory:read', { type: 'InventoryItem', storeId });
  if (requests.length === 0) return new Map();

  const items = await repo.listItems(principal, {
    storeId,
    productIds: requests.map((request) => request.productId),
    limit: requests.length,
  });
  const stockByProduct = new Map(items.map((item) => [item.productId, item.websiteStock]));

  return new Map(
    requests.map((request) => {
      const available = Math.max(0, stockByProduct.get(request.productId) ?? 0);
      return [
        request.productId,
        {
          productId: request.productId,
          requested: request.qty,
          available,
          sufficient: available >= request.qty,
        },
      ];
    }),
  );
}

/** What one product's stock looks like to a shopper. */
export interface AvailabilityRecord {
  readonly productId: string;
  readonly availability: Availability;
  /** Populated only in the `LOW` and `OUT_OF_STOCK` bands — see the domain note. */
  readonly remaining: number | null;
}

/**
 * Availability for a storefront page: bands, never counts (D2).
 *
 * A product with no inventory row at all is `OUT_OF_STOCK` rather than missing,
 * so a caller cannot accidentally render "in stock" for something that has
 * never been stocked.
 */
export async function availabilityFor(
  principal: Principal,
  storeId: string,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, AvailabilityRecord>> {
  assertAuthorized(principal, 'inventory:read', { type: 'InventoryItem', storeId });
  if (productIds.length === 0) return new Map();

  const items = await repo.listItems(principal, {
    storeId,
    productIds,
    limit: productIds.length,
  });
  const stockByProduct = new Map(items.map((item) => [item.productId, item.websiteStock]));

  return new Map(
    productIds.map((productId) => {
      const stock = stockByProduct.get(productId) ?? 0;
      return [
        productId,
        {
          productId,
          availability: availabilityOf(stock),
          remaining: displayableRemaining(stock),
        },
      ];
    }),
  );
}

export async function getStock(
  principal: Principal,
  storeId: string,
  productId: string,
): Promise<repo.InventoryRecord | null> {
  assertAuthorized(principal, 'inventory:read', { type: 'InventoryItem', storeId });
  refuseCustomer(principal);
  return repo.findItem(storeId, productId);
}

export interface LowStockRow {
  readonly item: repo.InventoryRecord;
  readonly threshold: number;
}

/**
 * Items at or below the store's low-stock threshold.
 *
 * The threshold comes from `StoreSettings.lowStockThreshold`, not a constant: a
 * small store and a large one do not agree on what "running out" means, and it
 * is a per-store business setting rather than infrastructure (§22).
 */
export async function listLowStock(
  principal: Principal,
  storeId: string,
  limit = 100,
): Promise<{ threshold: number; items: readonly repo.InventoryRecord[] }> {
  assertAuthorized(principal, 'inventory:read', { type: 'InventoryItem', storeId });
  const threshold = await repo.lowStockThresholdFor(storeId);
  const items = await repo.listLowStock(principal, storeId, threshold, Math.min(limit, 500));
  return { threshold, items };
}

/** The per-product movement history, newest first (§7 admin audit surface). */
export async function listLedger(
  principal: Principal,
  query: repo.LedgerQuery,
): Promise<readonly repo.LedgerRecord[]> {
  assertAuthorized(principal, 'stock-ledger:read', {
    type: 'StockLedger',
    storeId: query.storeId,
  });
  return repo.listLedger(principal, { ...query, limit: Math.min(query.limit ?? 200, 500) });
}

export { availabilityOf, displayableRemaining, isLow, LOW_STOCK_DISPLAY_THRESHOLD };

/** The store a scoped principal acts in; `null` when it is unscoped. */
function scopeOf(principal: Principal): string | null {
  return principal.kind === 'user' ? principal.storeId : null;
}
