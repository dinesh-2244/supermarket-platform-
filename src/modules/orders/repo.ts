/**
 * Prisma / SQL access for `orders`. Private to this module: nothing outside
 * `src/modules/orders` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * Read helpers take a `DbExecutor` so a caller inside a transaction can pass its
 * `Tx` handle and see its own uncommitted writes. Audited writes take a `Tx` and
 * nothing else — see `auditedExecutor` (§17).
 */
import {
  getPrisma,
  type Prisma,
  storeScopeFilter,
  type DbExecutor,
  type Principal,
  type Tx,
} from '../platform/index';
import type { OrderStatus, ValidatedTransition } from './state-machine';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

/**
 * The executor to run an *audited write* on.
 *
 * Deliberately has no `getPrisma()` fallback and takes the branded `Tx` that
 * only `withTransaction` can mint: a stock change without its `StockLedger` row
 * in the same commit, or an `Order.status` change without its history row, is
 * the failure mode §3/§17 exists to prevent. Passing the root client here is a
 * compile error, not a silent single-statement transaction.
 */
export function auditedExecutor(tx: Tx): Tx {
  return tx;
}

/** Just enough of an order to decide a transition and audit it. */
export interface LockedOrderRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly storeId: string;
  readonly customerId: string;
  readonly status: OrderStatus;
  readonly priceVarianceFlagged: boolean;
  readonly customerConfirmedRevisedAmount: boolean;
  readonly estimatedTotalPaise: number;
}

/**
 * The order row, locked for the rest of the transaction.
 *
 * Every status change reads the current state, decides against it and writes —
 * so without the lock two staff members acting at once could both read `PLACED`
 * and both write a first transition. Raw SQL because Prisma has no `FOR UPDATE`.
 */
export async function lockOrder(tx: Tx, orderId: string): Promise<LockedOrderRow | null> {
  const rows = await auditedExecutor(tx).$queryRaw<LockedOrderRow[]>`
    SELECT "id", "orderNumber", "storeId", "customerId", "status",
           "priceVarianceFlagged", "customerConfirmedRevisedAmount", "estimatedTotalPaise"
    FROM "Order"
    WHERE "id" = ${orderId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/**
 * Move the status and stamp the arrival column in one statement.
 *
 * **Takes a `ValidatedTransition`, not a status.** The target state and the
 * timestamp column are read off the rule, so a caller cannot name a status at
 * all — and a rule can only be obtained from `assertTransition`, which mints it
 * after checking the edge and its guard. That is what makes "`transition()` is
 * the only path that moves `Order.status`" hold by construction rather than by
 * a source scan's good intentions (OSCAR R8).
 *
 * The column name therefore comes from the table, never from a caller, and it
 * goes through Prisma's typed `update` rather than raw SQL.
 */
export async function setStatus(
  tx: Tx,
  orderId: string,
  rule: ValidatedTransition,
  at: Date,
): Promise<void> {
  await auditedExecutor(tx).order.update({
    where: { id: orderId },
    data: { status: rule.to, ...(rule.stamps === null ? {} : { [rule.stamps]: at }) },
  });
}

export interface StatusHistoryRow {
  readonly orderId: string;
  readonly fromStatus: OrderStatus | null;
  readonly toStatus: OrderStatus;
  readonly actorType: 'USER' | 'CUSTOMER' | 'SYSTEM';
  readonly actorId: string | null;
  readonly note: string | null;
}

/** Append-only, and written in the same transaction as the status change (§11). */
export async function insertStatusHistory(tx: Tx, row: StatusHistoryRow): Promise<void> {
  await auditedExecutor(tx).orderStatusHistory.create({
    data: {
      orderId: row.orderId,
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      actorType: row.actorType,
      actorId: row.actorId,
      note: row.note,
    },
  });
}

export interface NewOrderLine {
  readonly productId: string;
  readonly nameSnapshot: string;
  readonly packSizeSnapshot: string;
  readonly unitPricePaise: number;
  readonly qtyOrdered: number;
}

export interface NewOrder {
  readonly orderNumber: string;
  readonly trackingToken: string;
  readonly customerId: string;
  readonly storeId: string;
  readonly contactNameSnapshot: string;
  readonly contactPhoneSnapshot: string;
  readonly deliveryAddressSnapshotJson: unknown;
  readonly deliverySlotStart: Date;
  readonly deliverySlotEnd: Date;
  readonly paymentMethod: 'COD' | 'UPI_ON_DELIVERY';
  readonly subtotalPaise: number;
  readonly deliveryFeePaise: number;
  readonly estimatedTotalPaise: number;
  readonly lines: readonly NewOrderLine[];
}

export interface OrderIdentity {
  readonly id: string;
  readonly orderNumber: string;
  readonly trackingToken: string;
}

/** The order and all its lines, in one nested create. */
export async function insertOrder(tx: Tx, order: NewOrder): Promise<OrderIdentity> {
  const created = await auditedExecutor(tx).order.create({
    data: {
      orderNumber: order.orderNumber,
      trackingToken: order.trackingToken,
      customerId: order.customerId,
      storeId: order.storeId,
      contactNameSnapshot: order.contactNameSnapshot,
      contactPhoneSnapshot: order.contactPhoneSnapshot,
      // Round-tripped through JSON for the same reason the cart's notice is: a
      // plain structure is what Prisma's `InputJsonValue` can name, and the
      // snapshot is a frozen record rather than a live object.
      deliveryAddressSnapshotJson: JSON.parse(
        JSON.stringify(order.deliveryAddressSnapshotJson),
      ) as Prisma.InputJsonValue,
      deliverySlotStart: order.deliverySlotStart,
      deliverySlotEnd: order.deliverySlotEnd,
      paymentMethod: order.paymentMethod,
      status: 'PLACED',
      subtotalPaise: order.subtotalPaise,
      deliveryFeePaise: order.deliveryFeePaise,
      estimatedTotalPaise: order.estimatedTotalPaise,
      lines: {
        create: order.lines.map((line) => ({
          productId: line.productId,
          nameSnapshot: line.nameSnapshot,
          packSizeSnapshot: line.packSizeSnapshot,
          unitPricePaise: line.unitPricePaise,
          qtyOrdered: line.qtyOrdered,
        })),
      },
    },
    select: { id: true, orderNumber: true, trackingToken: true },
  });
  return created;
}

/**
 * How many live orders each of these windows already holds.
 *
 * "Live" excludes `CANCELLED_BY_STORE` only: a cancelled order has given its
 * stock back and freed its place, and every other state — including a failed
 * delivery — is still an order the store has to fulfil in that window.
 */
export async function countBySlot(
  db: DbExecutor,
  storeId: string,
  starts: readonly Date[],
): Promise<Map<number, number>> {
  if (starts.length === 0) return new Map();

  const rows = await executor(db).order.groupBy({
    by: ['deliverySlotStart'],
    where: {
      storeId,
      deliverySlotStart: { in: [...starts] },
      status: { not: 'CANCELLED_BY_STORE' },
    },
    _count: { _all: true },
  });

  return new Map(rows.map((row) => [row.deliverySlotStart.getTime(), row._count._all]));
}

/** How many live orders one window holds. Read inside the advisory lock. */
export async function countInSlot(tx: Tx, storeId: string, start: Date): Promise<number> {
  return auditedExecutor(tx).order.count({
    where: { storeId, deliverySlotStart: start, status: { not: 'CANCELLED_BY_STORE' } },
  });
}

/** A row in the back-office queue. Snapshots only — no joins a shopper owns. */
export interface QueueRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly storeId: string;
  readonly status: OrderStatus;
  readonly placedAt: Date;
  readonly deliverySlotStart: Date;
  readonly deliverySlotEnd: Date;
  readonly estimatedTotalPaise: number;
  readonly priceVarianceFlagged: boolean;
  readonly contactNameSnapshot: string;
}

const queueSelect = {
  id: true,
  orderNumber: true,
  storeId: true,
  status: true,
  placedAt: true,
  deliverySlotStart: true,
  deliverySlotEnd: true,
  estimatedTotalPaise: true,
  priceVarianceFlagged: true,
  contactNameSnapshot: true,
} as const;

/**
 * Orders this principal may see.
 *
 * The store scope is applied **here**, not by the caller: a queue that forgets
 * it is store-bound is an IDOR, and the one place it cannot be forgotten is the
 * query itself.
 */
export async function listForPrincipal(
  db: DbExecutor,
  principal: Principal,
  filter: { storeId?: string; statuses?: readonly OrderStatus[]; limit?: number },
): Promise<QueueRow[]> {
  return executor(db).order.findMany({
    where: {
      ...storeScopeFilter(principal),
      ...(filter.storeId === undefined ? {} : { storeId: filter.storeId }),
      ...(filter.statuses === undefined || filter.statuses.length === 0
        ? {}
        : { status: { in: [...filter.statuses] } }),
    },
    select: queueSelect,
    orderBy: [{ deliverySlotStart: 'asc' }, { placedAt: 'asc' }],
    take: filter.limit ?? 200,
  });
}

export interface StaffOrderRow extends QueueRow {
  readonly paymentMethod: 'COD' | 'UPI_ON_DELIVERY';
  readonly subtotalPaise: number;
  readonly deliveryFeePaise: number;
  readonly contactPhoneSnapshot: string;
  readonly deliveryAddressSnapshotJson: unknown;
  readonly posBillNumber: string | null;
  readonly posFinalTotalPaise: number | null;
  readonly customerConfirmedRevisedAmount: boolean;
  readonly revisedAmountConfirmedBy: string | null;
  readonly correctionReason: string | null;
  readonly store: { readonly name: string; readonly timezone: string };
  readonly lines: readonly {
    readonly id: string;
    readonly productId: string;
    readonly nameSnapshot: string;
    readonly packSizeSnapshot: string;
    readonly unitPricePaise: number;
    readonly qtyOrdered: number;
    readonly qtyPicked: number | null;
    readonly lineStatus: string;
    readonly stockRestoredQty: number;
  }[];
  readonly statusHistory: readonly {
    readonly fromStatus: OrderStatus | null;
    readonly toStatus: OrderStatus;
    readonly actorType: string;
    readonly actorId: string | null;
    readonly note: string | null;
    readonly createdAt: Date;
  }[];
}

/** One order in full, still store-scoped: a wrong-store id reads as not found. */
export async function findForPrincipal(
  db: DbExecutor,
  principal: Principal,
  orderId: string,
): Promise<StaffOrderRow | null> {
  const rows = await executor(db).order.findMany({
    where: { id: orderId, ...storeScopeFilter(principal) },
    select: {
      ...queueSelect,
      paymentMethod: true,
      subtotalPaise: true,
      deliveryFeePaise: true,
      contactPhoneSnapshot: true,
      deliveryAddressSnapshotJson: true,
      posBillNumber: true,
      posFinalTotalPaise: true,
      customerConfirmedRevisedAmount: true,
      revisedAmountConfirmedBy: true,
      correctionReason: true,
      store: { select: { name: true, timezone: true } },
      lines: {
        select: {
          id: true,
          productId: true,
          nameSnapshot: true,
          packSizeSnapshot: true,
          unitPricePaise: true,
          qtyOrdered: true,
          qtyPicked: true,
          lineStatus: true,
          stockRestoredQty: true,
        },
        orderBy: { nameSnapshot: 'asc' },
      },
      statusHistory: {
        select: {
          fromStatus: true,
          toStatus: true,
          actorType: true,
          actorId: true,
          note: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    take: 1,
  });
  return rows[0] ?? null;
}

export interface ConfirmationRow {
  readonly orderNumber: string;
  readonly trackingToken: string;
  readonly contactPhoneSnapshot: string;
  readonly estimatedTotalPaise: number;
  readonly deliverySlotStart: Date;
  readonly deliverySlotEnd: Date;
  readonly store: { readonly timezone: string };
}

/** The fields a confirmation message needs, and nothing else. */
export async function findConfirmationDetails(
  db: DbExecutor,
  orderId: string,
): Promise<ConfirmationRow | null> {
  return executor(db).order.findUnique({
    where: { id: orderId },
    select: {
      orderNumber: true,
      trackingToken: true,
      contactPhoneSnapshot: true,
      estimatedTotalPaise: true,
      deliverySlotStart: true,
      deliverySlotEnd: true,
      store: { select: { timezone: true } },
    },
  });
}

/** Record that a customer has agreed to the revised amount (D6). */
export async function setRevisedAmountConfirmed(
  tx: Tx,
  orderId: string,
  byUserId: string,
): Promise<void> {
  await auditedExecutor(tx).order.update({
    where: { id: orderId },
    data: { customerConfirmedRevisedAmount: true, revisedAmountConfirmedBy: byUserId },
  });
}

/** Is this human-facing order number already committed? */
export async function orderNumberTaken(tx: Tx, candidate: string): Promise<boolean> {
  const found = await auditedExecutor(tx).order.findUnique({
    where: { orderNumber: candidate },
    select: { id: true },
  });
  return found !== null;
}

/** Everything the guest tracking page renders, in one read. */
export interface TrackedOrderRow {
  readonly id: string;
  readonly orderNumber: string;
  readonly trackingToken: string;
  readonly status: OrderStatus;
  readonly paymentMethod: 'COD' | 'UPI_ON_DELIVERY';
  readonly deliverySlotStart: Date;
  readonly deliverySlotEnd: Date;
  readonly subtotalPaise: number;
  readonly deliveryFeePaise: number;
  readonly estimatedTotalPaise: number;
  readonly deliveryAddressSnapshotJson: unknown;
  readonly contactNameSnapshot: string;
  readonly placedAt: Date;
  readonly store: { readonly name: string; readonly timezone: string };
  readonly lines: readonly {
    readonly nameSnapshot: string;
    readonly packSizeSnapshot: string;
    readonly unitPricePaise: number;
    readonly qtyOrdered: number;
  }[];
  readonly statusHistory: readonly {
    readonly toStatus: OrderStatus;
    readonly createdAt: Date;
  }[];
}

/**
 * Look an order up by its opaque tracking token.
 *
 * `findUnique` on a unique column: one indexed lookup whether the token exists
 * or not, so a caller cannot tell a real-but-not-theirs token from a made-up one
 * by timing it. Deliberately **not** scoped by principal — the token *is* the
 * credential (§11), and it carries no customer data to leak.
 */
export async function findByTrackingToken(
  db: DbExecutor,
  trackingToken: string,
): Promise<TrackedOrderRow | null> {
  return executor(db).order.findUnique({
    where: { trackingToken },
    select: {
      id: true,
      orderNumber: true,
      trackingToken: true,
      status: true,
      paymentMethod: true,
      deliverySlotStart: true,
      deliverySlotEnd: true,
      subtotalPaise: true,
      deliveryFeePaise: true,
      estimatedTotalPaise: true,
      deliveryAddressSnapshotJson: true,
      contactNameSnapshot: true,
      placedAt: true,
      store: { select: { name: true, timezone: true } },
      lines: {
        select: {
          nameSnapshot: true,
          packSizeSnapshot: true,
          unitPricePaise: true,
          qtyOrdered: true,
        },
        orderBy: { nameSnapshot: 'asc' },
      },
      statusHistory: {
        select: { toStatus: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

/** What a restore needs to know about a line: how much is still outstanding. */
export interface RestorableLine {
  readonly id: string;
  readonly productId: string;
  readonly qtyOrdered: number;
  readonly stockRestoredQty: number;
}

export async function listLines(db: DbExecutor, orderId: string): Promise<RestorableLine[]> {
  return executor(db).orderLine.findMany({
    where: { orderId },
    select: { id: true, productId: true, qtyOrdered: true, stockRestoredQty: true },
    // Deterministic, so a correction takes its row locks in a stable order.
    orderBy: { productId: 'asc' },
  });
}

/**
 * Record that `qty` more of this line has gone back to website stock.
 *
 * An increment rather than a set: `stockRestoredQty` is the running total of
 * what a short-pick restore and an admin correction have between them given
 * back, and it is what stops the two double-restoring (R11).
 */
export async function addStockRestored(tx: Tx, lineId: string, qty: number): Promise<void> {
  await auditedExecutor(tx).orderLine.update({
    where: { id: lineId },
    data: { stockRestoredQty: { increment: qty } },
  });
}

export async function setCorrectionReason(tx: Tx, orderId: string, reason: string): Promise<void> {
  await auditedExecutor(tx).order.update({
    where: { id: orderId },
    data: { correctionReason: reason },
  });
}

/** Orders the principal may see — the scope filter lives here, not in callers. */
export function scopeFor(
  principal: Principal,
): Record<string, { in: readonly string[] }> | Record<string, never> {
  return storeScopeFilter(principal);
}
