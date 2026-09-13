/**
 * Prisma / SQL access for `fulfillment`. Private to this module: nothing outside
 * `src/modules/fulfillment` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * This module owns `PickTask`, `PosBillingHandoff` and `DeliveryRecord`. The
 * `Order` and `OrderLine` rows it works on belong to `orders`, and are reached
 * only through what `orders/index.ts` exports.
 *
 * Read helpers take a `DbExecutor` so a caller inside a transaction can pass its
 * `Tx` handle and see its own uncommitted writes. Audited writes take a `Tx` and
 * nothing else — see `auditedExecutor` (§17).
 */
import {
  getPrisma,
  storeScopeFilter,
  type DbExecutor,
  type Principal,
  type Tx,
} from '../platform/index';
import type { OrderStatus } from '../orders/index';

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

export type PickTaskStatus = 'OPEN' | 'IN_PROGRESS' | 'DONE';

export interface PickTaskRow {
  readonly id: string;
  readonly orderId: string;
  readonly status: PickTaskStatus;
  readonly assignedUserId: string | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
}

const pickTaskSelect = {
  id: true,
  orderId: true,
  status: true,
  assignedUserId: true,
  startedAt: true,
  completedAt: true,
} as const;

/** One task per order, opened on acceptance. */
export async function openPickTask(tx: Tx, orderId: string): Promise<PickTaskRow> {
  return auditedExecutor(tx).pickTask.create({ data: { orderId }, select: pickTaskSelect });
}

export async function findPickTask(db: DbExecutor, orderId: string): Promise<PickTaskRow | null> {
  return executor(db).pickTask.findUnique({ where: { orderId }, select: pickTaskSelect });
}

export async function startPickTask(
  tx: Tx,
  orderId: string,
  assignedUserId: string | null,
  at: Date,
): Promise<PickTaskRow> {
  return auditedExecutor(tx).pickTask.update({
    where: { orderId },
    data: { status: 'IN_PROGRESS', assignedUserId, startedAt: at },
    select: pickTaskSelect,
  });
}

export async function completePickTask(tx: Tx, orderId: string, at: Date): Promise<PickTaskRow> {
  return auditedExecutor(tx).pickTask.update({
    where: { orderId },
    data: { status: 'DONE', completedAt: at },
    select: pickTaskSelect,
  });
}

export interface PickingQueueRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly storeId: string;
  readonly status: OrderStatus;
  readonly placedAt: Date;
  readonly deliverySlotStart: Date;
  readonly deliverySlotEnd: Date;
  readonly contactNameSnapshot: string;
  readonly task: PickTaskRow;
  readonly linesTotal: number;
  readonly linesResolved: number;
}

/**
 * The store's orders waiting to be picked or being picked, oldest slot first.
 *
 * Queried through `PickTask` — this module's own table, which every accepted
 * order has — with the order joined in, rather than through `Order`, which
 * belongs to `orders`. A real filtered query, not a slice of the general
 * queue, scoped by the principal's stores in the query itself.
 */
export async function pickingQueue(
  db: DbExecutor,
  principal: Principal,
  storeId: string,
): Promise<PickingQueueRow[]> {
  const rows = await executor(db).pickTask.findMany({
    where: {
      order: {
        AND: [storeScopeFilter(principal), { storeId }],
        status: { in: ['ACCEPTED', 'PICKING'] },
      },
    },
    select: {
      ...pickTaskSelect,
      order: {
        select: {
          id: true,
          orderNumber: true,
          storeId: true,
          status: true,
          placedAt: true,
          deliverySlotStart: true,
          deliverySlotEnd: true,
          contactNameSnapshot: true,
          lines: { select: { lineStatus: true } },
        },
      },
    },
    orderBy: [{ order: { deliverySlotStart: 'asc' } }, { order: { placedAt: 'asc' } }],
    take: 200,
  });
  return rows.map(({ order, ...task }) => ({
    orderId: order.id,
    orderNumber: order.orderNumber,
    storeId: order.storeId,
    status: order.status,
    placedAt: order.placedAt,
    deliverySlotStart: order.deliverySlotStart,
    deliverySlotEnd: order.deliverySlotEnd,
    contactNameSnapshot: order.contactNameSnapshot,
    task,
    linesTotal: order.lines.length,
    linesResolved: order.lines.filter((line) => line.lineStatus !== 'PENDING').length,
  }));
}

// ---------------------------------------------------------------------------
// POS billing handoff (D2)
// ---------------------------------------------------------------------------

export interface PosBillingHandoffRow {
  readonly id: string;
  readonly orderId: string;
  readonly posBillNumber: string;
  readonly posFinalTotalPaise: number;
  readonly billedByUserId: string;
  readonly billedAt: Date;
  readonly discrepancyNote: string | null;
}

const handoffSelect = {
  id: true,
  orderId: true,
  posBillNumber: true,
  posFinalTotalPaise: true,
  billedByUserId: true,
  billedAt: true,
  discrepancyNote: true,
} as const;

/** One handoff per order — `orderId` is unique, so a second bill is a constraint error, not a silent overwrite. */
export async function insertHandoff(
  tx: Tx,
  bill: {
    readonly orderId: string;
    readonly posBillNumber: string;
    readonly posFinalTotalPaise: number;
    readonly billedByUserId: string;
    readonly discrepancyNote: string | null;
  },
): Promise<PosBillingHandoffRow> {
  return auditedExecutor(tx).posBillingHandoff.create({ data: bill, select: handoffSelect });
}

export async function findHandoff(
  db: DbExecutor,
  orderId: string,
): Promise<PosBillingHandoffRow | null> {
  return executor(db).posBillingHandoff.findUnique({ where: { orderId }, select: handoffSelect });
}

// ---------------------------------------------------------------------------
// Delivery record (D3 opens it on dispatch; D4 completes it)
// ---------------------------------------------------------------------------

export type DeliveryStatus = 'PENDING' | 'OUT' | 'DELIVERED' | 'FAILED';
export type DeliveryPaymentMethod = 'CASH' | 'UPI';

export interface DeliveryRecordRow {
  readonly id: string;
  readonly orderId: string;
  readonly assigneeName: string | null;
  readonly status: DeliveryStatus;
  readonly outAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly paymentMethodUsed: DeliveryPaymentMethod | null;
  readonly amountCollectedPaise: number | null;
  readonly upiRef: string | null;
  readonly failureReason: string | null;
}

const deliverySelect = {
  id: true,
  orderId: true,
  assigneeName: true,
  status: true,
  outAt: true,
  deliveredAt: true,
  paymentMethodUsed: true,
  amountCollectedPaise: true,
  upiRef: true,
  failureReason: true,
} as const;

/**
 * Mark the order out for delivery: one record per order (`orderId` is
 * unique), created on the first dispatch and reused on a re-dispatch after a
 * failed attempt — the previous failure reason is kept until the outcome
 * overwrites it, so the trail of the last attempt is not lost mid-way.
 */
export async function markOut(
  tx: Tx,
  orderId: string,
  assigneeName: string | null,
  at: Date,
): Promise<DeliveryRecordRow> {
  return auditedExecutor(tx).deliveryRecord.upsert({
    where: { orderId },
    create: { orderId, assigneeName, status: 'OUT', outAt: at },
    update: { ...(assigneeName === null ? {} : { assigneeName }), status: 'OUT', outAt: at },
    select: deliverySelect,
  });
}

export async function findDelivery(
  db: DbExecutor,
  orderId: string,
): Promise<DeliveryRecordRow | null> {
  return executor(db).deliveryRecord.findUnique({ where: { orderId }, select: deliverySelect });
}

export async function markDelivered(
  tx: Tx,
  orderId: string,
  payment: {
    readonly paymentMethodUsed: DeliveryPaymentMethod;
    readonly amountCollectedPaise: number;
    readonly upiRef: string | null;
  },
  at: Date,
): Promise<DeliveryRecordRow> {
  return auditedExecutor(tx).deliveryRecord.update({
    where: { orderId },
    data: { status: 'DELIVERED', deliveredAt: at, ...payment },
    select: deliverySelect,
  });
}

export async function markFailed(
  tx: Tx,
  orderId: string,
  failureReason: string,
): Promise<DeliveryRecordRow> {
  return auditedExecutor(tx).deliveryRecord.update({
    where: { orderId },
    data: { status: 'FAILED', failureReason },
    select: deliverySelect,
  });
}

export interface DeliveryQueueRow {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly storeId: string;
  readonly status: OrderStatus;
  readonly deliverySlotStart: Date;
  readonly deliverySlotEnd: Date;
  readonly contactNameSnapshot: string;
  readonly contactPhoneSnapshot: string;
  readonly deliveryAddressSnapshotJson: unknown;
  readonly paymentMethod: 'COD' | 'UPI_ON_DELIVERY';
  readonly amountDuePaise: number;
  readonly delivery: DeliveryRecordRow;
}

/**
 * The store's orders out on the road or back after a failed attempt, with
 * their delivery record — queried through `DeliveryRecord`, this module's own
 * table, which every dispatched order has. The amount due is the POS bill
 * where there is one, else the estimate.
 */
export async function deliveryQueue(
  db: DbExecutor,
  principal: Principal,
  storeId: string,
): Promise<DeliveryQueueRow[]> {
  const rows = await executor(db).deliveryRecord.findMany({
    where: {
      order: {
        AND: [storeScopeFilter(principal), { storeId }],
        status: { in: ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED'] },
      },
    },
    select: {
      ...deliverySelect,
      order: {
        select: {
          id: true,
          orderNumber: true,
          storeId: true,
          status: true,
          deliverySlotStart: true,
          deliverySlotEnd: true,
          contactNameSnapshot: true,
          contactPhoneSnapshot: true,
          deliveryAddressSnapshotJson: true,
          paymentMethod: true,
          estimatedTotalPaise: true,
          posFinalTotalPaise: true,
        },
      },
    },
    orderBy: [{ order: { deliverySlotStart: 'asc' } }, { outAt: 'asc' }],
    take: 200,
  });
  return rows.map(({ order, ...delivery }) => ({
    orderId: order.id,
    orderNumber: order.orderNumber,
    storeId: order.storeId,
    status: order.status,
    deliverySlotStart: order.deliverySlotStart,
    deliverySlotEnd: order.deliverySlotEnd,
    contactNameSnapshot: order.contactNameSnapshot,
    contactPhoneSnapshot: order.contactPhoneSnapshot,
    deliveryAddressSnapshotJson: order.deliveryAddressSnapshotJson,
    paymentMethod: order.paymentMethod,
    amountDuePaise: order.posFinalTotalPaise ?? order.estimatedTotalPaise,
    delivery,
  }));
}
