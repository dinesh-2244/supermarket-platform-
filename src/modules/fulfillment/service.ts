/**
 * Use-cases for `fulfillment` (Phase 5): walking a real order through the
 * lifecycle Phase 4 built. Services open transactions, enforce authorization,
 * call `orders.transition` for every status change and emit after commit.
 *
 * Nothing here writes `Order.status`, invents an edge, or moves stock by any
 * path other than `inventory.applyMovement` — the state machine and the
 * branded-`Tx` stock rule are consumed, not rebuilt.
 */
import {
  assertAuthorized,
  AuthzError,
  ConflictError,
  getPrisma,
  NotFoundError,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type Principal,
  type Tx,
} from '../platform/index';
import {
  addStockRestored,
  announceTransition,
  checkTransition,
  computeVariance,
  confirmRevisedAmount as confirmRevisedAmountOnOrder,
  listPickLines,
  lockOrder,
  lockPickLine,
  queueForStore,
  setLineOutcome,
  setPosBill,
  staffOrder,
  transition,
  type LockedOrderRow,
  type OrderStatus,
  type PickLineRow,
  type QueueRow,
  type TransitionOutcome,
  type VarianceResult,
} from '../orders/index';
import { applyMovement } from '../inventory/index';
import { getListing } from '../pricing/index';
import { getSettings } from '../stores/index';
import { posBillingGatewayFor } from './pos/pos-billing-gateway';
import {
  descriptor,
  requireReason,
  restoreQuantity,
  validateLineOutcome,
  validatePaymentCapture,
  type DeliveredInput,
  type LinePickInput,
  type ModuleDescriptor,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type {
  DeliveryPaymentMethod,
  DeliveryQueueRow,
  DeliveryRecordRow,
  DeliveryStatus,
  PickingQueueRow,
  PickTaskRow,
  PickTaskStatus,
  PosBillingHandoffRow,
} from './repo';

/**
 * Lock the order and check the actor may drive it.
 *
 * Every use-case starts here. The lock comes first so the status the step is
 * checked against is the one about to be written; the authorization is against
 * the order's *own* store. An order outside the actor's stores is **not found**
 * rather than forbidden — same as `orders.staffOrder` — and an order in the
 * wrong state names the state it is in.
 */
async function lockForActor(
  tx: Tx,
  actor: Principal,
  orderId: string,
  expected: readonly OrderStatus[],
): Promise<LockedOrderRow> {
  const order = await lockOrder(tx, orderId);
  if (order === null) throw new NotFoundError('No such order', { orderId });
  if (actor.kind === 'user' && actor.role !== 'SUPER_ADMIN' && actor.storeId !== order.storeId) {
    throw new NotFoundError('No such order', { orderId });
  }
  assertAuthorized(actor, 'order:transition', {
    type: 'Order',
    id: orderId,
    storeId: order.storeId,
  });
  if (!expected.includes(order.status)) {
    throw new ConflictError(`That order is ${order.status}, not ${expected.join(' or ')}`, {
      orderId,
      status: order.status,
    });
  }
  return order;
}

/**
 * Accept a `PLACED` order and open its pick task.
 *
 * The task row is what the picking queue is built on, so it is created in the
 * same transaction as the transition — an accepted order without a task would
 * be invisible to the people meant to pick it.
 */
export async function acceptOrder(actor: Principal, orderId: string): Promise<TransitionOutcome> {
  const outcome = await withTransaction(async (tx) => {
    await lockForActor(tx, actor, orderId, ['PLACED']);
    const moved = await transition(tx, orderId, 'ACCEPTED', actor);
    await repo.openPickTask(tx, orderId);
    return moved;
  });
  announceTransition(outcome);
  return outcome;
}

/**
 * Start picking: the task is claimed for `assignedUserId` (the actor, unless
 * a manager assigns somebody else) and the order moves to `PICKING`.
 */
export async function startPicking(
  actor: Principal,
  orderId: string,
  assignedUserId?: string | null,
): Promise<TransitionOutcome> {
  const outcome = await withTransaction(async (tx) => {
    await lockForActor(tx, actor, orderId, ['ACCEPTED']);
    const task = await repo.findPickTask(tx, orderId);
    if (task === null) {
      throw new ConflictError('That order has no pick task — it was not accepted here', {
        orderId,
      });
    }
    const picker = assignedUserId ?? (actor.kind === 'user' ? actor.userId : null);
    const moved = await transition(tx, orderId, 'PICKING', actor);
    await repo.startPickTask(tx, orderId, picker, new Date());
    return moved;
  });
  announceTransition(outcome);
  return outcome;
}

/**
 * Record what the shelf had for one line, while the order is `PICKING`.
 *
 * A `SHORT` or `UNAVAILABLE` line gives `qtyOrdered − qtyPicked −
 * stockRestoredQty` back to `websiteStock` through `applyMovement` — so the
 * `StockLedger` row with its `balanceAfter` lands in this same transaction —
 * and bumps `stockRestoredQty` by the same amount, which is what stops a later
 * `cancelByStore` from restoring those units a second time. A line is recorded
 * once: reversing a recorded outcome would mean taking stock back off the
 * shelf, which is a different operation than this one and not in this phase.
 */
export async function recordLinePick(
  actor: Principal,
  orderId: string,
  lineId: string,
  input: LinePickInput,
): Promise<PickLineRow> {
  return withTransaction(async (tx) => {
    const order = await lockForActorPicking(tx, actor, orderId);
    const line = await lockPickLine(tx, orderId, lineId);
    if (line === null) throw new NotFoundError('No such line on that order', { orderId, lineId });
    if (line.lineStatus !== 'PENDING') {
      throw new ConflictError(`That line is already recorded as ${line.lineStatus}`, {
        lineId,
        lineStatus: line.lineStatus,
      });
    }

    const outcome = validateLineOutcome(line.qtyOrdered, input);
    if (outcome.substituteProductId !== null) {
      const listing = await getListing(actor, order.storeId, outcome.substituteProductId);
      if (!listing?.isListed) {
        throw new ValidationError('That substitute is not listed at this store', {
          substituteProductId: outcome.substituteProductId,
        });
      }
    }

    const note = (input.note ?? '').trim() || null;
    let restored = 0;
    let balanceAfter: number | null = null;
    if (outcome.restores) {
      restored = restoreQuantity({
        qtyOrdered: line.qtyOrdered,
        qtyPicked: outcome.qtyPicked,
        stockRestoredQty: line.stockRestoredQty,
      });
      if (restored > 0) {
        const movement = await applyMovement(tx, actor, {
          storeId: order.storeId,
          productId: line.productId,
          delta: restored,
          reason: 'PICK_SHORT_RESTORE',
          refType: 'Order',
          refId: orderId,
          note,
        });
        balanceAfter = movement.balanceAfter;
        await addStockRestored(tx, line.id, restored);
      }
    }

    const updated = await setLineOutcome(tx, line.id, {
      lineStatus: outcome.lineStatus,
      qtyPicked: outcome.qtyPicked,
      substituteProductId: outcome.substituteProductId,
    });
    await writeAuditLog(tx, {
      principal: actor,
      action: 'update',
      entityType: 'OrderLine',
      entityId: line.id,
      storeId: order.storeId,
      before: { lineStatus: line.lineStatus, qtyPicked: line.qtyPicked },
      after: {
        lineStatus: outcome.lineStatus,
        qtyPicked: outcome.qtyPicked,
        substituteProductId: outcome.substituteProductId,
        restored,
        balanceAfter,
        note,
      },
    });
    return updated;
  });
}

/** The `PICKING` precondition, worded for the line-recording screen. */
async function lockForActorPicking(
  tx: Tx,
  actor: Principal,
  orderId: string,
): Promise<LockedOrderRow> {
  try {
    return await lockForActor(tx, actor, orderId, ['PICKING']);
  } catch (error) {
    if (error instanceof ConflictError) {
      throw new ConflictError('That order is not being picked right now', error.details);
    }
    throw error;
  }
}

/**
 * Finish picking: every line must be recorded; the task is marked done and the
 * order moves to `PICKED`, ready for the POS bill.
 */
export async function completePicking(
  actor: Principal,
  orderId: string,
): Promise<TransitionOutcome> {
  const outcome = await withTransaction(async (tx) => {
    await lockForActor(tx, actor, orderId, ['PICKING']);
    const lines = await listPickLines(tx, orderId);
    const pending = lines.filter((line) => line.lineStatus === 'PENDING');
    if (pending.length > 0) {
      throw new ConflictError(
        `${pending.length} line${pending.length === 1 ? ' is' : 's are'} still to pick`,
        { orderId, pending: pending.map((line) => line.id) },
      );
    }
    const moved = await transition(tx, orderId, 'PICKED', actor);
    await repo.completePickTask(tx, orderId, new Date());
    return moved;
  });
  announceTransition(outcome);
  return outcome;
}

/**
 * The lines of an order as picking sees them, for the picking screen. Read
 * through `orders.staffOrder`, so an order outside the actor's stores is `null`
 * here too rather than a list of somebody else's lines.
 */
export async function pickLines(actor: Principal, orderId: string): Promise<PickLineRow[] | null> {
  const order = await staffOrder(actor, orderId);
  if (order === null) return null;
  return listPickLines(getPrisma(), orderId);
}

/**
 * The store's picking queue — `ACCEPTED` and `PICKING` orders with their task
 * and how many lines are done. `order:read` against the store asked for, and
 * the repository scopes on top.
 */
export async function pickingQueue(
  actor: Principal,
  storeId: string,
): Promise<repo.PickingQueueRow[]> {
  assertAuthorized(actor, 'order:read', { type: 'Order', storeId });
  return repo.pickingQueue(getPrisma(), actor, storeId);
}

// ---------------------------------------------------------------------------
// D2 — POS billing handoff (manual mode only)
// ---------------------------------------------------------------------------

export interface FinalBillFormInput {
  readonly billNumber: string;
  readonly finalTotalPaise: number;
  readonly discrepancyNote?: string | null;
}

export interface BilledOrder {
  readonly outcome: TransitionOutcome;
  readonly handoff: repo.PosBillingHandoffRow;
  /** What the store's threshold made of the bill — shown right after submit. */
  readonly variance: VarianceResult;
}

/**
 * Record the final POS bill for a `PICKED` order.
 *
 * The bill comes through the store's `PosBillingGateway` (ADR-0007) — in this
 * phase always the manual one, a staff member typing in what the POS printed.
 * Then, in one transaction: the `PosBillingHandoff` row, the order's POS
 * fields, `priceVarianceFlagged` from `computeVariance` against the store's own
 * thresholds, and the `BILLED_IN_POS` transition. This is the first time
 * `posFinalTotalPaise` is ever set on a real order, which is what makes the
 * `PACKED → OUT_FOR_DELIVERY` guard mean something.
 */
export async function recordFinalBill(
  actor: Principal,
  orderId: string,
  input: FinalBillFormInput,
): Promise<BilledOrder> {
  if (actor.kind !== 'user') {
    throw new AuthzError('You do not have permission to perform this action', {});
  }
  const billed = await withTransaction(async (tx) => {
    const order = await lockForActor(tx, actor, orderId, ['PICKED']);
    const settings = await getSettings(actor, order.storeId);
    const gateway = posBillingGatewayFor(settings.posMode);
    const bill = await gateway.recordFinalBill(orderId, {
      billNumber: input.billNumber,
      finalTotalPaise: input.finalTotalPaise,
      billedByUserId: actor.userId,
      discrepancyNote: input.discrepancyNote ?? null,
    });
    const variance = computeVariance({
      estimatedTotalPaise: order.estimatedTotalPaise,
      posFinalTotalPaise: bill.finalTotalPaise,
      percentBp: settings.priceVariancePercentBp,
      absCapPaise: settings.priceVarianceAbsCapPaise,
    });

    const handoff = await repo.insertHandoff(tx, {
      orderId,
      posBillNumber: bill.billNumber,
      posFinalTotalPaise: bill.finalTotalPaise,
      billedByUserId: bill.billedByUserId,
      discrepancyNote: bill.discrepancyNote,
    });
    await setPosBill(tx, orderId, {
      posBillNumber: bill.billNumber,
      posFinalTotalPaise: bill.finalTotalPaise,
      priceVarianceFlagged: variance.flagged,
    });
    const outcome = await transition(tx, orderId, 'BILLED_IN_POS', actor, bill.discrepancyNote);
    await writeAuditLog(tx, {
      principal: actor,
      action: 'update',
      entityType: 'Order',
      entityId: orderId,
      storeId: order.storeId,
      before: { status: order.status, estimatedTotalPaise: order.estimatedTotalPaise },
      after: {
        status: 'BILLED_IN_POS',
        posBillNumber: bill.billNumber,
        posFinalTotalPaise: bill.finalTotalPaise,
        variance,
        posMode: gateway.mode,
      },
    });
    return { outcome, handoff, variance };
  });
  announceTransition(billed.outcome, undefined, { priceVarianceFlagged: billed.variance.flagged });
  return billed;
}

/**
 * Confirm a revised amount with the customer — Phase 4's action, reachable
 * from here so the billing screen has one surface. Manager-or-above; the
 * rule lives in `orders`.
 */
export async function confirmRevisedAmount(actor: Principal, orderId: string): Promise<void> {
  return confirmRevisedAmountOnOrder(actor, orderId);
}

/** The handoff recorded for an order, if any — for the detail screen. */
export async function billingDetails(
  actor: Principal,
  orderId: string,
): Promise<repo.PosBillingHandoffRow | null> {
  const order = await staffOrder(actor, orderId);
  if (order === null) return null;
  return repo.findHandoff(getPrisma(), orderId);
}

/** The store's `PICKED` orders — waiting for their POS bill. */
export async function billingQueue(actor: Principal, storeId: string): Promise<QueueRow[]> {
  return queueForStore(actor, storeId, { statuses: ['PICKED'] });
}

// ---------------------------------------------------------------------------
// D3 — packing and dispatch
// ---------------------------------------------------------------------------

/** `BILLED_IN_POS → PACKED`. */
export async function markPacked(actor: Principal, orderId: string): Promise<TransitionOutcome> {
  const outcome = await withTransaction(async (tx) => {
    await lockForActor(tx, actor, orderId, ['BILLED_IN_POS']);
    return transition(tx, orderId, 'PACKED', actor);
  });
  announceTransition(outcome);
  return outcome;
}

/**
 * `PACKED → OUT_FOR_DELIVERY`, and the delivery record goes `OUT`.
 *
 * The variance guard is the state machine's, applied unchanged inside
 * `transition`: an order whose POS bill came in over tolerance is refused here
 * until a manager has confirmed the revised amount with the customer. This is
 * the first place that guard is exercised by a real bill rather than a unit
 * test. The record is opened in the same transaction, so a dispatched order
 * always has one for the outcome to complete.
 */
export async function dispatch(
  actor: Principal,
  orderId: string,
  options: { readonly assigneeName?: string | null } = {},
): Promise<TransitionOutcome> {
  const assignee = (options.assigneeName ?? '').trim() || null;
  const outcome = await withTransaction(async (tx) => {
    await lockForActor(tx, actor, orderId, ['PACKED']);
    const moved = await transition(tx, orderId, 'OUT_FOR_DELIVERY', actor, assignee);
    await repo.markOut(tx, orderId, assignee, new Date());
    return moved;
  });
  announceTransition(outcome);
  return outcome;
}

export interface DispatchQueueRow extends QueueRow {
  /** The guard's reason a dispatch would be refused right now, or `null`. */
  readonly dispatchBlockedBy: string | null;
}

/**
 * The store's `BILLED_IN_POS` and `PACKED` orders, each saying whether the
 * variance guard would block its dispatch — asked of the state machine, so the
 * screen's "blocked" badge and the refusal it would get agree by construction.
 */
export async function dispatchQueue(
  actor: Principal,
  storeId: string,
): Promise<DispatchQueueRow[]> {
  const rows = await queueForStore(actor, storeId, { statuses: ['BILLED_IN_POS', 'PACKED'] });
  const orders = await Promise.all(rows.map((row) => staffOrder(actor, row.id)));
  return rows.map((row, i) => {
    const order = orders[i];
    if (order === null || order === undefined) return { ...row, dispatchBlockedBy: null };
    const check = checkTransition('PACKED', 'OUT_FOR_DELIVERY', {
      priceVarianceFlagged: order.priceVarianceFlagged,
      customerConfirmedRevisedAmount: order.customerConfirmedRevisedAmount,
    });
    return { ...row, dispatchBlockedBy: check.ok ? null : check.reason };
  });
}

// ---------------------------------------------------------------------------
// D4 — delivery outcome
// ---------------------------------------------------------------------------

/** The delivery record must exist — dispatch opened it — or the data is inconsistent, not merely absent. */
async function requireDelivery(tx: Tx, orderId: string): Promise<repo.DeliveryRecordRow> {
  const record = await repo.findDelivery(tx, orderId);
  if (record === null) {
    throw new ConflictError('That order has no delivery record — it was not dispatched here', {
      orderId,
    });
  }
  return record;
}

/**
 * `OUT_FOR_DELIVERY → DELIVERED`, with what was collected at the door. The
 * amount due (the POS bill) is recorded beside the amount collected in the
 * audit row, so a shortfall is visible without being a refusal.
 */
export async function recordDelivered(
  actor: Principal,
  orderId: string,
  input: DeliveredInput,
): Promise<TransitionOutcome> {
  const payment = validatePaymentCapture(input);
  const outcome = await withTransaction(async (tx) => {
    const order = await lockForActor(tx, actor, orderId, ['OUT_FOR_DELIVERY']);
    await requireDelivery(tx, orderId);
    const moved = await transition(tx, orderId, 'DELIVERED', actor);
    await repo.markDelivered(tx, orderId, payment, new Date());
    await writeAuditLog(tx, {
      principal: actor,
      action: 'update',
      entityType: 'Order',
      entityId: orderId,
      storeId: order.storeId,
      before: { status: order.status },
      after: { status: 'DELIVERED', ...payment, amountDuePaise: order.estimatedTotalPaise },
    });
    return moved;
  });
  announceTransition(outcome);
  return outcome;
}

/** `OUT_FOR_DELIVERY → DELIVERY_FAILED`, with why. The order stays retryable. */
export async function recordDeliveryFailed(
  actor: Principal,
  orderId: string,
  input: { readonly failureReason: string },
): Promise<TransitionOutcome> {
  const reason = requireReason(input.failureReason, 'A failed delivery');
  const outcome = await withTransaction(async (tx) => {
    await lockForActor(tx, actor, orderId, ['OUT_FOR_DELIVERY']);
    await requireDelivery(tx, orderId);
    const moved = await transition(tx, orderId, 'DELIVERY_FAILED', actor, reason);
    await repo.markFailed(tx, orderId, reason);
    return moved;
  });
  announceTransition(outcome);
  return outcome;
}

/** `DELIVERY_FAILED → OUT_FOR_DELIVERY`: the same record goes out again. */
export async function retryDelivery(
  actor: Principal,
  orderId: string,
  options: { readonly assigneeName?: string | null } = {},
): Promise<TransitionOutcome> {
  const assignee = (options.assigneeName ?? '').trim() || null;
  const outcome = await withTransaction(async (tx) => {
    await lockForActor(tx, actor, orderId, ['DELIVERY_FAILED']);
    await requireDelivery(tx, orderId);
    const moved = await transition(tx, orderId, 'OUT_FOR_DELIVERY', actor, assignee);
    await repo.markOut(tx, orderId, assignee, new Date());
    return moved;
  });
  announceTransition(outcome);
  return outcome;
}

/**
 * `DELIVERY_FAILED → CLOSED_UNDELIVERED`, terminally, with a reason — and the
 * goods go back on the shelf.
 *
 * Everything the order still holds — `qtyOrdered − stockRestoredQty` per line,
 * which is exactly what picking put in the basket, since short, unavailable
 * and substituted lines have already restored their remainder — returns to
 * `websiteStock` through `applyMovement` (`PICK_SHORT_RESTORE`, `refId` the
 * order), and `stockRestoredQty` is bumped to match. The same counter and the
 * same arithmetic as `cancelByStore`, so nothing is ever restored twice
 * (decision 2026-09-13, Q2).
 */
export async function closeUndelivered(
  actor: Principal,
  orderId: string,
  reason: string,
): Promise<TransitionOutcome> {
  const why = requireReason(reason, 'Closing an undelivered order');
  const outcome = await withTransaction(async (tx) => {
    const order = await lockForActor(tx, actor, orderId, ['DELIVERY_FAILED']);
    const moved = await transition(tx, orderId, 'CLOSED_UNDELIVERED', actor, why);

    const restored: { productId: string; qty: number; balanceAfter: number }[] = [];
    for (const line of await listPickLines(tx, orderId)) {
      const outstanding = restoreQuantity({
        qtyOrdered: line.qtyOrdered,
        qtyPicked: 0,
        stockRestoredQty: line.stockRestoredQty,
      });
      if (outstanding === 0) continue;
      const movement = await applyMovement(tx, actor, {
        storeId: order.storeId,
        productId: line.productId,
        delta: outstanding,
        reason: 'PICK_SHORT_RESTORE',
        refType: 'Order',
        refId: orderId,
        note: `Undelivered — ${why}`,
      });
      await addStockRestored(tx, line.id, outstanding);
      restored.push({
        productId: line.productId,
        qty: outstanding,
        balanceAfter: movement.balanceAfter,
      });
    }

    await writeAuditLog(tx, {
      principal: actor,
      action: 'update',
      entityType: 'Order',
      entityId: orderId,
      storeId: order.storeId,
      before: { status: order.status },
      after: { status: 'CLOSED_UNDELIVERED', reason: why, restored },
    });
    return moved;
  });
  announceTransition(outcome, why);
  return outcome;
}

/**
 * `DELIVERED → CLOSED` — a staff confirmation that nothing further is owed
 * either way (the cash is in the till, no complaint came back).
 *
 * Deliberately manual rather than an automatic close after N days: nothing in
 * this codebase runs on a schedule yet, and inventing a scheduler for one
 * transition is a Phase 6 (ops hardening) decision. When one exists, it calls
 * this function for delivered orders older than the window — the rule stays
 * here, the timer stays there.
 */
export async function closeOrder(actor: Principal, orderId: string): Promise<TransitionOutcome> {
  const outcome = await withTransaction(async (tx) => {
    await lockForActor(tx, actor, orderId, ['DELIVERED']);
    return transition(tx, orderId, 'CLOSED', actor);
  });
  announceTransition(outcome);
  return outcome;
}

/** The delivery record for an order, if any — for the detail screen. */
export async function deliveryDetails(
  actor: Principal,
  orderId: string,
): Promise<repo.DeliveryRecordRow | null> {
  const order = await staffOrder(actor, orderId);
  if (order === null) return null;
  return repo.findDelivery(getPrisma(), orderId);
}

/** The store's orders out for delivery or back after a failed attempt. */
export async function deliveryQueue(
  actor: Principal,
  storeId: string,
): Promise<repo.DeliveryQueueRow[]> {
  assertAuthorized(actor, 'order:read', { type: 'Order', storeId });
  return repo.deliveryQueue(getPrisma(), actor, storeId);
}
