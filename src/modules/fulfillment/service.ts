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
  listPickLines,
  lockOrder,
  lockPickLine,
  setLineOutcome,
  staffOrder,
  transition,
  type LockedOrderRow,
  type OrderStatus,
  type PickLineRow,
  type TransitionOutcome,
} from '../orders/index';
import { applyMovement } from '../inventory/index';
import { getListing } from '../pricing/index';
import {
  descriptor,
  restoreQuantity,
  validateLineOutcome,
  type LinePickInput,
  type ModuleDescriptor,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type { PickingQueueRow, PickTaskRow, PickTaskStatus } from './repo';

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
 * A `SHORT`, `UNAVAILABLE` or `SUBSTITUTED` line gives `qtyOrdered − (units of
 * the ordered product picked) − stockRestoredQty` back to `websiteStock` through `applyMovement` — so the
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
        qtyPicked: outcome.restoreBasis,
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
