/**
 * Use-cases for `orders`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 *
 * The rule this module exists to hold: **`transition()` is the only code path
 * that mutates `Order.status`.** Nothing else in `src/` calls `order.update`
 * with a `status`, which `orders.test.ts` asserts by grepping the tree. A status
 * that could move without `transition()` is a status that can move without its
 * `OrderStatusHistory` row, and the history is the audit trail (§11).
 */
import {
  assertAuthorized,
  AuthzError,
  ConflictError,
  getPrisma,
  emit,
  NotFoundError,
  orderNumber as mintOrderNumber,
  trackingToken as mintTrackingToken,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type Principal,
  type Tx,
} from '../platform/index';
import { applyMovement } from '../inventory/index';
import { descriptor, type ModuleDescriptor } from './domain/index';
import * as repo from './repo';
import {
  assertTransition,
  canCancelByStore,
  requiresDiscrepancyNote,
  type OrderStatus,
  type OrderTransitionEvent,
} from './state-machine';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
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
 * What a transition did, and what its caller still owes the event bus.
 *
 * The event is *returned* rather than emitted here on purpose. `transition()`
 * runs inside the caller's transaction, and a handler that fires before that
 * transaction commits has announced something that may still roll back. The
 * transaction-opening wrappers below emit after the commit; an in-transaction
 * caller (checkout, and Phase 5's fulfillment use-cases) does the same with the
 * outcome it gets back.
 */
export interface TransitionOutcome {
  readonly orderId: string;
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly emits: OrderTransitionEvent | null;
  readonly storeId: string;
}

/**
 * Move one order to `to`, inside the caller's transaction.
 *
 * The order row is locked first, so the state the edge is validated against is
 * the state that is about to be written — two staff members acting at once
 * cannot both read `PLACED` and both apply a first transition. An illegal edge,
 * or a guard that refuses, throws before anything is written.
 */
export async function transition(
  tx: Tx,
  orderId: string,
  to: OrderStatus,
  actor: Principal,
  note?: string | null,
): Promise<TransitionOutcome> {
  const order = await repo.lockOrder(tx, orderId);
  if (order === null) {
    throw new NotFoundError('No such order', { orderId });
  }

  const rule = assertTransition(order.status, to, {
    priceVarianceFlagged: order.priceVarianceFlagged,
    customerConfirmedRevisedAmount: order.customerConfirmedRevisedAmount,
  });

  const { actorType, actorId } = actorOf(actor);
  await repo.setStatus(tx, orderId, rule, new Date());
  await repo.insertStatusHistory(tx, {
    orderId,
    fromStatus: order.status,
    toStatus: to,
    actorType,
    actorId,
    note: note ?? null,
  });

  return {
    orderId,
    from: order.status,
    to,
    emits: rule.emits,
    storeId: order.storeId,
  };
}

/** Emit what a committed transition owes the bus. Never called before commit. */
function announce(outcome: TransitionOutcome, reason?: string): void {
  switch (outcome.emits) {
    // Id-only, which is every edge except the two that predate Phase 4 and
    // carry a field. The bus names identifiers; a subscriber that needs the
    // order looks it up, so no customer detail travels on it.
    case 'order.accepted':
    case 'order.picking':
    case 'order.picked':
    case 'order.packed':
    case 'order.dispatched':
    case 'order.delivered':
    case 'order.closed':
    case 'order.delivery_failed':
    case 'order.closed_undelivered':
      emit(outcome.emits, { orderId: outcome.orderId });
      return;
    case 'order.billed':
      emit(outcome.emits, { orderId: outcome.orderId, priceVarianceFlagged: false });
      return;
    case 'order.cancelled_by_store':
      emit(outcome.emits, { orderId: outcome.orderId, reason: reason ?? '' });
      return;
  }
}

/**
 * How many live orders each window already holds, for the slot picker.
 *
 * Advisory: it is read outside any lock and can be stale by the time a shopper
 * chooses. The **authoritative** capacity gate is the locked count inside
 * `checkout.placeOrder`. That split is deliberate — a picker that took the lock
 * would serialise every page load behind every placement.
 */
export async function slotUsage(
  storeId: string,
  starts: readonly Date[],
): Promise<Map<number, number>> {
  return repo.countBySlot(getPrisma(), storeId, starts);
}

/**
 * The locked count `placeOrder` gates on. Must be called with the store's
 * delivery-slot advisory lock already held, or two placements will each read
 * the same N and each commit the N+1st.
 */
export async function liveOrdersInSlot(tx: Tx, storeId: string, start: Date): Promise<number> {
  return repo.countInSlot(tx, storeId, start);
}

/** One step of the human timeline the tracking page shows. */
export interface TimelineStep {
  readonly status: OrderStatus;
  readonly label: string;
  readonly at: Date;
}

export interface TrackedOrder {
  readonly orderNumber: string;
  readonly trackingToken: string;
  readonly status: OrderStatus;
  readonly statusLabel: string;
  readonly paymentMethod: 'COD' | 'UPI_ON_DELIVERY';
  readonly slotStart: Date;
  readonly slotEnd: Date;
  /** Pre-rendered in the **shop's** timezone, not the reader's. */
  readonly slotLabel: string;
  readonly placedAt: Date;
  readonly storeName: string;
  /** The shop's timezone, so a page renders every time in it and not the reader's. */
  readonly storeTimeZone: string;
  readonly deliveryLocality: string | null;
  readonly subtotalPaise: number;
  readonly deliveryFeePaise: number;
  readonly estimatedTotalPaise: number;
  readonly lines: readonly {
    readonly name: string;
    readonly packSize: string;
    readonly unitPricePaise: number;
    readonly qty: number;
    readonly lineTotalPaise: number;
  }[];
  readonly timeline: readonly TimelineStep[];
}

/** What each state means to a shopper, who does not know the enum. */
const STATUS_LABEL: Readonly<Record<OrderStatus, string>> = {
  PLACED: 'Order placed',
  ACCEPTED: 'Accepted by the shop',
  PICKING: 'Being picked',
  PICKED: 'Picked',
  BILLED_IN_POS: 'Billed',
  PACKED: 'Packed',
  OUT_FOR_DELIVERY: 'Out for delivery',
  DELIVERED: 'Delivered',
  CLOSED: 'Completed',
  CANCELLED_BY_STORE: 'Cancelled by the shop',
  DELIVERY_FAILED: 'Delivery attempt failed',
  CLOSED_UNDELIVERED: 'Closed — not delivered',
};

function formatSlot(start: Date, end: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(start);
  const time = (at: Date): string =>
    new Intl.DateTimeFormat('en-IN', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  return `${day}, ${time(start)} – ${time(end)}`;
}

/** The locality the shopper typed, if the snapshot recorded one. */
function localityFrom(snapshot: unknown): string | null {
  if (typeof snapshot !== 'object' || snapshot === null) return null;
  const value = (snapshot as Record<string, unknown>).locality;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Read an order by its opaque tracking token, for the guest tracking page.
 *
 * **Read-only and unauthenticated by design** (§11, D5): the token is the
 * credential. It returns `null` for an unknown token so the caller can answer a
 * generic 404 — the same answer for a well-formed-but-unknown token, a garbage
 * one and a token belonging to somebody else, with no timing tell, because the
 * lookup is one indexed `findUnique` either way.
 *
 * It writes nothing. There is deliberately no variant of this that does.
 */
export async function orderForTracking(trackingToken: string): Promise<TrackedOrder | null> {
  const token = trackingToken.trim();
  if (token.length === 0) return null;

  const row = await repo.findByTrackingToken(getPrisma(), token);
  if (row === null) return null;

  return {
    orderNumber: row.orderNumber,
    trackingToken: row.trackingToken,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status],
    paymentMethod: row.paymentMethod,
    slotStart: row.deliverySlotStart,
    slotEnd: row.deliverySlotEnd,
    slotLabel: formatSlot(row.deliverySlotStart, row.deliverySlotEnd, row.store.timezone),
    placedAt: row.placedAt,
    storeName: row.store.name,
    storeTimeZone: row.store.timezone,
    deliveryLocality: localityFrom(row.deliveryAddressSnapshotJson),
    subtotalPaise: row.subtotalPaise,
    deliveryFeePaise: row.deliveryFeePaise,
    estimatedTotalPaise: row.estimatedTotalPaise,
    lines: row.lines.map((line) => ({
      name: line.nameSnapshot,
      packSize: line.packSizeSnapshot,
      unitPricePaise: line.unitPricePaise,
      qty: line.qtyOrdered,
      lineTotalPaise: line.unitPricePaise * line.qtyOrdered,
    })),
    timeline: row.statusHistory.map((entry) => ({
      status: entry.toStatus,
      label: STATUS_LABEL[entry.toStatus],
      at: entry.createdAt,
    })),
  };
}

export interface NewOrderInput {
  readonly storeCode: string;
  readonly customerId: string;
  readonly storeId: string;
  readonly contactName: string;
  readonly contactPhone: string;
  readonly deliveryAddressSnapshot: unknown;
  readonly deliverySlotStart: Date;
  readonly deliverySlotEnd: Date;
  readonly paymentMethod: 'COD' | 'UPI_ON_DELIVERY';
  readonly subtotalPaise: number;
  readonly deliveryFeePaise: number;
  readonly lines: readonly repo.NewOrderLine[];
}

export interface CreatedOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly trackingToken: string;
  readonly estimatedTotalPaise: number;
}

/** How many order numbers to try before giving up and letting the index decide. */
const ORDER_NUMBER_ATTEMPTS = 5;

/**
 * Write a new order at `PLACED`.
 *
 * Internal to Phase 4: only `checkout.placeOrder` calls it, and only inside the
 * transaction that decremented the stock. `PLACED` is the **initial state**, not
 * a transition — there is no `null → PLACED` edge in the table — so this writes
 * the opening `OrderStatusHistory` row itself (`fromStatus: null`) rather than
 * going through `transition()`.
 *
 * `estimatedTotalPaise` is computed here from subtotal + delivery fee rather
 * than accepted from the caller: it is the number the shopper is quoted, and a
 * caller that could pass its own could quote a total the lines do not add up to.
 */
export async function createOrder(tx: Tx, input: NewOrderInput): Promise<CreatedOrder> {
  if (input.lines.length === 0) {
    throw new ValidationError('An order needs at least one line', {});
  }

  const estimatedTotalPaise = input.subtotalPaise + input.deliveryFeePaise;
  const trackingToken = mintTrackingToken();

  // The number carries a CSPRNG tail, so a collision is already unlikely; this
  // checks the candidate against what is committed and tries again rather than
  // letting the unique index abort the whole placement. The index remains the
  // backstop for the residual case of two concurrent placements minting the
  // same tail, neither able to see the other's uncommitted row.
  let created: repo.OrderIdentity | null = null;
  for (let attempt = 0; attempt < ORDER_NUMBER_ATTEMPTS && created === null; attempt += 1) {
    const candidate = mintOrderNumber(input.storeCode);
    if (await repo.orderNumberTaken(tx, candidate)) continue;

    created = await repo.insertOrder(tx, {
      orderNumber: candidate,
      trackingToken,
      customerId: input.customerId,
      storeId: input.storeId,
      contactNameSnapshot: input.contactName,
      contactPhoneSnapshot: input.contactPhone,
      deliveryAddressSnapshotJson: input.deliveryAddressSnapshot,
      deliverySlotStart: input.deliverySlotStart,
      deliverySlotEnd: input.deliverySlotEnd,
      paymentMethod: input.paymentMethod,
      subtotalPaise: input.subtotalPaise,
      deliveryFeePaise: input.deliveryFeePaise,
      estimatedTotalPaise,
      lines: input.lines,
    });
  }

  if (created === null) {
    throw new ConflictError('Could not mint a unique order number', {
      attempts: ORDER_NUMBER_ATTEMPTS,
    });
  }

  await repo.insertStatusHistory(tx, {
    orderId: created.id,
    fromStatus: null,
    toStatus: 'PLACED',
    actorType: 'CUSTOMER',
    actorId: null,
    note: null,
  });

  return { ...created, estimatedTotalPaise };
}

/**
 * The store's queue, for the back office.
 *
 * `order:read` is checked against the store being asked for, and the repository
 * applies the `allowedStoreIds` scope on top — belt and braces, because these
 * two protect different mistakes. The authorization stops a staff member asking
 * for another store; the scope filter stops an unscoped query returning it
 * anyway if someone later forgets the first check.
 */
export async function queueForStore(
  principal: Principal,
  storeId: string,
  filter: { statuses?: readonly OrderStatus[]; limit?: number } = {},
): Promise<repo.QueueRow[]> {
  assertAuthorized(principal, 'order:read', { type: 'Order', storeId });
  return repo.listForPrincipal(getPrisma(), principal, { storeId, ...filter });
}

/**
 * One order in full for staff. A wrong-store id reads as **not found** rather
 * than forbidden: telling somebody an order exists but is not theirs is itself
 * a disclosure, and there is nothing they can do with the distinction.
 */
export async function staffOrder(
  principal: Principal,
  orderId: string,
): Promise<repo.StaffOrderRow | null> {
  const order = await repo.findForPrincipal(getPrisma(), principal, orderId);
  if (order === null) return null;
  assertAuthorized(principal, 'order:read', { type: 'Order', id: orderId, storeId: order.storeId });
  return order;
}

/**
 * Record that the customer has agreed to a revised amount (D6, R6).
 *
 * This is the *input* to the `PACKED → OUT_FOR_DELIVERY` guard, not the guard
 * itself — the state machine owns that. Manager-or-above, because it changes
 * what a customer is asked to pay.
 *
 * Setting `posBillNumber` / `posFinalTotalPaise` — the entry that raises the
 * flag in the first place — is Phase 5.
 */
export async function confirmRevisedAmount(principal: Principal, orderId: string): Promise<void> {
  if (principal.kind !== 'user') {
    throw new AuthzError('Only staff can confirm a revised amount', {});
  }
  const actorId = principal.userId;

  await withTransaction(async (tx) => {
    const order = await repo.lockOrder(tx, orderId);
    if (order === null) throw new NotFoundError('No such order', { orderId });

    assertAuthorized(principal, 'order:confirm-variance', {
      type: 'Order',
      id: orderId,
      storeId: order.storeId,
    });

    if (!order.priceVarianceFlagged) {
      throw new ConflictError('That order has no price variance to confirm', { orderId });
    }

    await repo.setRevisedAmountConfirmed(tx, orderId, actorId);
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'Order',
      entityId: orderId,
      storeId: order.storeId,
      before: { customerConfirmedRevisedAmount: false },
      after: { customerConfirmedRevisedAmount: true, revisedAmountConfirmedBy: actorId },
    });
  });
}

/**
 * Just enough of an order for a confirmation message.
 *
 * Separate from `orderForTracking` because the two answer different questions
 * and leak differently: this one deliberately *does* carry the phone number,
 * because that is the address the message goes to, and it is handed straight to
 * the provider rather than rendered on a page.
 */
export interface ConfirmationDetails {
  readonly phone: string;
  readonly orderNumber: string;
  readonly trackingToken: string;
  readonly estimatedTotalPaise: number;
  readonly slotLabel: string;
}

export async function confirmationDetails(orderId: string): Promise<ConfirmationDetails | null> {
  const row = await repo.findConfirmationDetails(getPrisma(), orderId);
  if (row === null) return null;

  return {
    phone: row.contactPhoneSnapshot,
    orderNumber: row.orderNumber,
    trackingToken: row.trackingToken,
    estimatedTotalPaise: row.estimatedTotalPaise,
    slotLabel: formatSlot(row.deliverySlotStart, row.deliverySlotEnd, row.store.timezone),
  };
}

export interface CancelResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly restored: readonly { productId: string; qty: number; balanceAfter: number }[];
}

/**
 * The audited store correction — the **only** way an order ends early (R4).
 *
 * Restores each line's not-yet-restored quantity (`qtyOrdered − stockRestoredQty`)
 * with an `ADMIN_CORRECTION` ledger row and bumps `stockRestoredQty` by the same
 * amount, so a Phase 5 short-pick restore and this correction can never give the
 * same unit back twice. A line already fully restored contributes nothing and
 * writes no ledger row — a zero-delta movement is not a movement.
 */
export async function cancelByStore(
  tx: Tx,
  orderId: string,
  actor: Principal,
  reason: string,
  discrepancyNote?: string | null,
): Promise<CancelResult> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new ValidationError('A correction needs a reason', { orderId });
  }

  const order = await repo.lockOrder(tx, orderId);
  if (order === null) {
    throw new NotFoundError('No such order', { orderId });
  }

  // Store-scoped, and manager-or-above. Checked against the order's own store,
  // so a manager cannot correct the other store's order.
  assertAuthorized(actor, 'order:cancel', {
    type: 'Order',
    id: orderId,
    storeId: order.storeId,
  });

  if (!canCancelByStore(order.status)) {
    throw new ConflictError('That order can no longer be cancelled by the store', {
      orderId,
      status: order.status,
    });
  }

  if (requiresDiscrepancyNote(order.status) && (discrepancyNote ?? '').trim().length === 0) {
    throw new ValidationError(
      'This order has a POS bill — record how the bill was voided before cancelling',
      { orderId, status: order.status },
    );
  }

  const note = discrepancyNote == null ? trimmed : `${trimmed} — ${discrepancyNote.trim()}`;

  // Through the state machine like any other edge, so the correction gets its
  // `OrderStatusHistory` row and its `correctedAt` stamp from the same table
  // that governs the rest of the lifecycle.
  await transition(tx, orderId, 'CANCELLED_BY_STORE', actor, note);

  const lines = await repo.listLines(tx, orderId);
  const restored: { productId: string; qty: number; balanceAfter: number }[] = [];
  for (const line of lines) {
    const outstanding = line.qtyOrdered - line.stockRestoredQty;
    if (outstanding <= 0) continue;

    const movement = await applyMovement(tx, actor, {
      storeId: order.storeId,
      productId: line.productId,
      delta: outstanding,
      reason: 'ADMIN_CORRECTION',
      refType: 'Order',
      refId: orderId,
      note,
    });
    await repo.addStockRestored(tx, line.id, outstanding);
    restored.push({
      productId: line.productId,
      qty: outstanding,
      balanceAfter: movement.balanceAfter,
    });
  }

  await repo.setCorrectionReason(tx, orderId, note);
  await writeAuditLog(tx, {
    principal: actor,
    action: 'update',
    entityType: 'Order',
    entityId: orderId,
    storeId: order.storeId,
    before: { status: order.status },
    after: { status: 'CANCELLED_BY_STORE', correctionReason: note, restored },
  });

  return { orderId, orderNumber: order.orderNumber, restored };
}

/**
 * `cancelByStore` with its own transaction, for callers that are not already in
 * one (the admin server action). Emits after the commit, never before.
 */
export async function correctOrder(
  actor: Principal,
  orderId: string,
  reason: string,
  discrepancyNote?: string | null,
): Promise<CancelResult> {
  const result = await withTransaction((tx) =>
    cancelByStore(tx, orderId, actor, reason, discrepancyNote),
  );
  emit('order.cancelled_by_store', { orderId, reason: reason.trim() });
  return result;
}

/**
 * `transition` with its own transaction — **the public mutation boundary**, and
 * therefore where authorization lives.
 *
 * Two rules, both learned the hard way (OSCAR R1). The first version of this
 * function checked the state edge and nothing else, which meant a shopper, a
 * staff member or the *other store's* manager could drive any order to
 * `CANCELLED_BY_STORE`: it wrote the status and a null-reason history row, took
 * no stock back, wrote no `AuditLog`, and left the order terminal so the real
 * correction could never recover the restoration it had skipped.
 *
 * 1. **Authorization is checked here**, against the order's own store, before
 *    anything is written. `transition` itself stays an in-transaction primitive
 *    with no opinion about who is calling — it is not exported, so there is no
 *    unauthorized way to reach it.
 * 2. **`CANCELLED_BY_STORE` is refused outright.** Ending an order is not a
 *    generic edge: it must restore stock, write an audit row and carry a reason.
 *    That is `cancelByStore` / `correctOrder`, and a second path to the same
 *    state is exactly how the two drift apart.
 */
export async function applyTransition(
  actor: Principal,
  orderId: string,
  to: OrderStatus,
  note?: string | null,
): Promise<TransitionOutcome> {
  if (to === 'CANCELLED_BY_STORE') {
    throw new ConflictError(
      'Cancelling an order goes through the store correction, which restores stock and records a reason',
      { orderId, use: 'correctOrder' },
    );
  }

  const outcome = await withTransaction(async (tx) => {
    const order = await repo.lockOrder(tx, orderId);
    if (order === null) throw new NotFoundError('No such order', { orderId });

    assertAuthorized(actor, 'order:transition', {
      type: 'Order',
      id: orderId,
      storeId: order.storeId,
    });

    return transition(tx, orderId, to, actor, note);
  });

  announce(outcome, note ?? undefined);
  return outcome;
}
