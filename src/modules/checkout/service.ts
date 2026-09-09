/**
 * Use-cases for `checkout`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 *
 * This module owns exactly one interesting operation, `placeOrder`, and the
 * reason it is interesting is that **everything it does has to commit together**:
 * the revalidation the quote is based on, the stock it takes off the shelf, the
 * ledger row that explains that stock, the customer it hangs the order on, the
 * order itself, and the basket it converts. Any one of those surviving without
 * the others is a defect the rest of the system cannot repair (§3, R5).
 */
import {
  ConflictError,
  emit,
  LOCK_NAMESPACE,
  tryAdvisoryXactLock,
  ValidationError,
  withTransaction,
  type Principal,
  type Tx,
} from '../platform/index';
import { lockCartForCheckout, markConverted, revalidateForCheckout } from '../cart/index';
import { upsertCheckoutCustomer } from '../customers/index';
import { applyMovement } from '../inventory/index';
import { createOrder, liveOrdersInSlot, slotUsage, type NewOrderLine } from '../orders/index';
import {
  getStore,
  resolveServiceability,
  slotEndOf,
  slotGridFor,
  type ServiceabilityInput,
  type Slot,
} from '../stores/index';
import {
  assertPaymentMethod,
  descriptor,
  shortfallsIn,
  type LineShortfall,
  type ModuleDescriptor,
  type PaymentMethod,
} from './domain/index';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

/**
 * The delivery windows a shopper may choose, with how much room each has left.
 *
 * **Why this lives in `checkout` and not in `stores`.** The plan puts
 * `availableSlots` on the `stores` read interface, and the *shape* of a window —
 * length, capacity, timezone, lead time, horizon — does live there
 * (`stores.slotGridFor`). What could not follow it is the usage count: that is a
 * fact about `Order` rows, which `orders` owns (§4), and R7's model-ownership
 * rule exists precisely to stop one module reaching into another's tables. The
 * alternative was to make `stores` depend on `orders`, which would put the
 * module that `cart`, `catalog` and `checkout` all sit on top of above the one
 * that sits on top of it. So the composition happens here, in the module that
 * already legitimately sees both. The signature and semantics are the plan's.
 *
 * `capacityRemaining` is **advisory**: read outside any lock, it can be stale by
 * the time the shopper picks. The authoritative gate is the locked count in
 * `placeOrder`. A picker that took the lock would serialise every page load
 * behind every placement, and would still be stale by the time the form posted.
 */
export async function availableSlots(
  principal: Principal,
  storeId: string,
  from: Date,
  options: { horizonDays?: number; leadMinutes?: number } = {},
): Promise<Slot[]> {
  const grid = await slotGridFor(principal, storeId, from, options);
  const usage = await slotUsage(storeId, grid.starts);

  return grid.starts.map((start) => ({
    start,
    end: slotEndOf(start, grid.slotLengthMinutes),
    capacityRemaining: Math.max(0, grid.slotCapacity - (usage.get(start.getTime()) ?? 0)),
  }));
}

/**
 * Placement does real work — revalidate, lock and decrement every line, write the
 * order. Prisma's 5 s default is comfortable for one shopper and not for the
 * twelfth. A ceiling for a pathological case, not a budget: an uncontended
 * placement finishes in tens of milliseconds.
 */
const PLACEMENT_TRANSACTION = { timeoutMs: 20_000, maxWaitMs: 20_000 } as const;

/**
 * Thrown inside the transaction when another placement holds this window's lock,
 * and caught by `placeOrder` — never by a caller. It exists so the transaction
 * can be *abandoned* rather than blocked: see the retry loop below.
 */
class SlotBusy extends Error {}

/** How many times to come back for a busy window, and how long to wait. */
const SLOT_LOCK_ATTEMPTS = 12;
const SLOT_LOCK_BACKOFF_MS = 25;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface PlaceOrderInput {
  readonly cartToken: string;
  readonly contact: { readonly name: string; readonly phone: string };
  /** The same shape `resolveServiceability` takes — checkout never re-routes. */
  readonly addressInput: ServiceabilityInput;
  /** Free-text the shopper typed, snapshotted onto the order as given. */
  readonly addressLines?: { readonly line1?: string; readonly line2?: string };
  readonly slotStart: Date;
  readonly paymentMethod: string;
  /** Present when the shopper is signed in, so the order joins their account. */
  readonly customerSession?: { readonly customerId: string } | null;
  /** Injectable for tests; defaults to the real clock. */
  readonly now?: Date;
}

export interface PlacedOrder {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly trackingToken: string;
  readonly storeId: string;
  readonly slotStart: Date;
  readonly slotEnd: Date;
  readonly subtotalPaise: number;
  readonly deliveryFeePaise: number;
  readonly estimatedTotalPaise: number;
  readonly paymentMethod: PaymentMethod;
}

/** A rejection that names the lines responsible, so the page can point at them. */
export class ShortfallError extends ConflictError {
  constructor(shortfalls: readonly LineShortfall[]) {
    super('Some items are no longer available in the quantity you asked for', {
      reason: 'stock-shortfall',
      lines: shortfalls,
    });
  }
}

/**
 * Turn a revalidated basket into a placed order.
 *
 * Serviceability is resolved **before** the transaction opens: it is a pure read
 * that decides which store we are even talking about, and holding a transaction
 * open across it would buy nothing. Everything after it is one transaction.
 */
export async function placeOrder(
  principal: Principal,
  input: PlaceOrderInput,
): Promise<PlacedOrder> {
  const now = input.now ?? new Date();
  const paymentMethod = assertPaymentMethod(input.paymentMethod);
  const contactName = input.contact.name.trim();
  const contactPhone = input.contact.phone.trim();
  if (contactName.length === 0) throw new ValidationError('Tell us who to deliver to', {});
  if (contactPhone.length === 0) throw new ValidationError('We need a phone number', {});

  // `resolveServiceability` is the single routing authority, and that includes
  // whether the shop is open: it returns `store-closed` for a store with
  // `isAcceptingOrders: false`. Checkout deliberately does **not** re-check that
  // flag — two places deciding the same thing is how they come to disagree.
  const serviceability = await resolveServiceability(input.addressInput);
  if (!serviceability.servable) {
    throw new ConflictError(
      serviceability.reason === 'store-closed'
        ? 'This shop is not taking orders right now'
        : 'We do not deliver to that address yet',
      { reason: serviceability.reason },
    );
  }

  const { storeId, deliveryFeePaise, minOrderPaise } = serviceability;

  // The shopper's principal is scoped to the store their area resolved to. A
  // guest arrives with `storeId: null`, so it is bound here rather than trusted
  // from the caller.
  const shopper: Principal = { kind: 'customer', customerId: null, storeId };

  // The same grid the picker was built from, so a slot that could be offered is
  // exactly a slot that can be booked. Lead time and horizon are checked here,
  // not re-derived: one definition, asked twice.
  const grid = await slotGridFor(shopper, storeId, now);
  if (!grid.starts.some((start) => start.getTime() === input.slotStart.getTime())) {
    throw new ConflictError('That delivery window is not available', {
      reason: 'slot-unavailable',
      slotStart: input.slotStart.toISOString(),
    });
  }
  const slotFinish = slotEndOf(input.slotStart, grid.slotLengthMinutes);

  const store = await getStore(shopper, storeId);

  const attempt = async (): Promise<PlacedOrder> =>
    withTransaction(async (tx: Tx) => {
      // The delivery window comes first, before any other lock and any work.
      //
      // Capacity is a rule about a *set* of orders and the one about to join it
      // does not exist yet, so no row lock can serialise it. The lock is per
      // (store, window): two different windows never contend.
      //
      // **Try**, never block. A transaction blocked on a lock goes on holding
      // its database connection, so a dozen shoppers queueing on one window
      // exhaust the pool — CI runs `connection_limit=5` — and even placements
      // that never reached the lock die with a pool timeout: every one of them
      // failing, where three should have succeeded. Failing fast and retrying
      // outside the transaction hands the connection back between attempts, so
      // concurrency is bounded by the pool for *work* and not for *waiting*.
      //
      // Taking it **first** is what makes that retry cheap. A shopper who finds
      // the window busy has spent one query, not a revalidation and a row lock
      // on every line of their basket. Retrying the expensive part instead was
      // measurably worse than blocking: nine shoppers kept re-contending on the
      // same inventory row and the pool starved anyway.
      const locked = await tryAdvisoryXactLock(
        tx,
        LOCK_NAMESPACE.deliverySlot,
        `${storeId}:${input.slotStart.toISOString()}`,
      );
      if (!locked) throw new SlotBusy();

      const taken = await liveOrdersInSlot(tx, storeId, input.slotStart);
      if (taken >= grid.slotCapacity) {
        throw new ConflictError('That delivery window is full — please choose another', {
          reason: 'slot-full',
          slotStart: input.slotStart.toISOString(),
          capacity: grid.slotCapacity,
        });
      }

      // Locks the cart row, and refuses one that is already CONVERTED. That is the
      // double-submit guard: the second of two simultaneous submissions waits on
      // the row lock, then reads the status the first one committed.
      //
      // `revalidateForCheckout` below takes the same lock again — cheap, and it
      // means the guard does not depend on the order of these two calls. Taking it
      // here as well buys the store check below, which should reject a
      // wrong-store basket before any revalidation work is done.
      const cart = await lockCartForCheckout(tx, input.cartToken);

      // A basket belongs to one shop, and checkout never silently cross-stores it.
      // The Phase 3 rebuild flow is how a shopper reconciles a changed area.
      if (cart.storeId !== storeId) {
        throw new ConflictError(
          'Your basket is for a different shop — change your delivery area to move it',
          { reason: 'wrong-store', cartStoreId: cart.storeId, addressStoreId: storeId },
        );
      }

      // Server-authoritative: whatever the page last showed, this is what the
      // store says now, and it is what the shopper is charged from.
      const view = await revalidateForCheckout(tx, shopper, input.cartToken);
      if (view.lines.length === 0) {
        throw new ConflictError('Your basket is empty', { reason: 'empty-cart' });
      }

      const shortfalls = shortfallsIn(view);
      if (shortfalls.length > 0) throw new ShortfallError(shortfalls);

      const subtotalPaise = view.totals.subtotalPaise;
      if (subtotalPaise < minOrderPaise) {
        throw new ConflictError('Your basket is below this shop’s minimum order', {
          reason: 'below-minimum',
          subtotalPaise,
          minOrderPaise,
        });
      }

      // Deterministic order — by productId — so two concurrent placements that
      // share products acquire their row locks in the same sequence and wait for
      // each other instead of deadlocking.
      const ordered = [...view.lines].sort((a, b) => a.productId.localeCompare(b.productId));

      const lines: NewOrderLine[] = [];
      for (const line of ordered) {
        // Locks the row, refuses a negative balance, writes the ledger row with
        // `balanceAfter` — all in this transaction. The last-unit race is decided
        // here: the loser waits for the lock, re-reads, and cannot go below zero.
        await applyMovement(tx, shopper, {
          storeId,
          productId: line.productId,
          delta: -line.qty,
          reason: 'ORDER_PLACED',
          refType: 'Cart',
          refId: cart.id,
        });

        lines.push({
          productId: line.productId,
          nameSnapshot: line.name,
          packSizeSnapshot: line.packSize,
          unitPricePaise: line.unitPricePaise,
          qtyOrdered: line.qty,
        });
      }

      const customer = await upsertCheckoutCustomer(tx, { phone: contactPhone, name: contactName });
      // A signed-in shopper's order joins their account; it never overwrites a
      // different customer's row, because the phone number is what identifies it.
      const customerId = input.customerSession?.customerId ?? customer.id;

      const order = await createOrder(tx, {
        storeCode: store.code,
        customerId,
        storeId,
        contactName,
        contactPhone,
        deliveryAddressSnapshot: {
          areaId: serviceability.areaId,
          zoneId: serviceability.zoneId,
          line1: input.addressLines?.line1 ?? null,
          line2: input.addressLines?.line2 ?? null,
          locality: input.addressInput.locality ?? null,
          pincode: input.addressInput.pincode ?? null,
        },
        deliverySlotStart: input.slotStart,
        deliverySlotEnd: slotFinish,
        paymentMethod,
        subtotalPaise,
        deliveryFeePaise,
        lines,
      });

      await markConverted(tx, cart.id);

      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        trackingToken: order.trackingToken,
        storeId,
        slotStart: input.slotStart,
        slotEnd: slotFinish,
        subtotalPaise,
        deliveryFeePaise,
        estimatedTotalPaise: order.estimatedTotalPaise,
        paymentMethod,
      } satisfies PlacedOrder;
    }, PLACEMENT_TRANSACTION);

  // Retry only the "somebody else is writing into this window right now" case.
  // Everything else — full, out of stock, wrong shop — is a decision, and
  // repeating it would only produce the same answer more slowly.
  let placed: PlacedOrder | null = null;
  for (let tries = 0; tries < SLOT_LOCK_ATTEMPTS && placed === null; tries += 1) {
    try {
      placed = await attempt();
    } catch (error) {
      if (!(error instanceof SlotBusy)) throw error;
      // Jittered, so twelve shoppers who arrive together do not come back
      // together and collide again in lockstep.
      await sleep(SLOT_LOCK_BACKOFF_MS * (tries + 1) * (0.5 + Math.random()));
    }
  }

  if (placed === null) {
    throw new ConflictError('That delivery window is busy — please try again', {
      reason: 'slot-busy',
      slotStart: input.slotStart.toISOString(),
    });
  }

  // After the commit, exactly once. Emitting inside the transaction would
  // announce an order that can still roll back.
  emit('order.placed', { orderId: placed.orderId, storeId: placed.storeId });

  return placed;
}
