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
  advisoryXactLock,
  ConflictError,
  emit,
  LOCK_NAMESPACE,
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
 * order — and then queues behind other placements into the same delivery window.
 * Prisma's 5 s default is comfortable for one shopper and not for the twelfth,
 * and a transaction timeout reaches them as an opaque error where "that window
 * is full" is the true answer. This is a ceiling for a pathological case, not a
 * budget: an uncontended placement finishes in tens of milliseconds.
 */
const PLACEMENT_TRANSACTION = { timeoutMs: 20_000, maxWaitMs: 20_000 } as const;

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

  const placed = await withTransaction(async (tx: Tx) => {
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

    // Capacity is a rule about a *set* of orders, and the one about to join it
    // does not exist yet — so no row lock can serialise it. Without this, N
    // simultaneous placements would each count the same N-1 and each commit.
    // The lock is per (store, window): two different windows never contend.
    //
    // Taken here rather than earlier on purpose. An advisory *xact* lock is held
    // until commit, so everything after this point is serialised against every
    // other placement into the same window — and the queue that forms is real
    // time each waiter spends holding an open transaction. Revalidation and the
    // per-line stock decrements do not need this lock (they have their own row
    // locks), so they now happen outside it and the serialised section is just
    // count → write → commit. Under the plan's N ≫ C test that is the difference
    // between the last waiter seeing "that window is full" and seeing Prisma's
    // transaction-timeout error.
    await advisoryXactLock(
      tx,
      LOCK_NAMESPACE.deliverySlot,
      `${storeId}:${input.slotStart.toISOString()}`,
    );
    const taken = await liveOrdersInSlot(tx, storeId, input.slotStart);
    if (taken >= grid.slotCapacity) {
      throw new ConflictError('That delivery window is full — please choose another', {
        reason: 'slot-full',
        slotStart: input.slotStart.toISOString(),
        capacity: grid.slotCapacity,
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

  // After the commit, exactly once. Emitting inside the transaction would
  // announce an order that can still roll back.
  emit('order.placed', { orderId: placed.orderId, storeId: placed.storeId });

  return placed;
}
