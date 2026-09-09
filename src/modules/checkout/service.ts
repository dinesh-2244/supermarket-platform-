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
  ValidationError,
  withTransaction,
  type Principal,
  type Tx,
} from '../platform/index';
import { lockCartForCheckout, markConverted, revalidateForCheckout } from '../cart/index';
import { upsertCheckoutCustomer } from '../customers/index';
import { applyMovement } from '../inventory/index';
import { createOrder, type NewOrderLine } from '../orders/index';
import { getStore, getStorefrontSettings, resolveServiceability } from '../stores/index';
import type { ServiceabilityInput } from '../stores/index';
import {
  assertPaymentMethod,
  assertSlotShape,
  descriptor,
  shortfallsIn,
  slotEnd,
  type LineShortfall,
  type ModuleDescriptor,
  type PaymentMethod,
} from './domain/index';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
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

  // Read for the slot length only — the shape of this shop's delivery windows.
  const settings = await getStorefrontSettings(shopper, storeId);

  assertSlotShape({ start: input.slotStart, slotLengthMinutes: settings.slotLengthMinutes, now });
  const slotFinish = slotEnd(input.slotStart, settings.slotLengthMinutes);

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
  });

  // After the commit, exactly once. Emitting inside the transaction would
  // announce an order that can still roll back.
  emit('order.placed', { orderId: placed.orderId, storeId: placed.storeId });

  return placed;
}
