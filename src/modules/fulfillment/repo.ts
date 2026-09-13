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
