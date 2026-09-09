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
import type { OrderStatus, OrderTimestampField } from './state-machine';

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
 * The column name comes from the transition table, never from a caller, so the
 * interpolation below can only ever be one of the nine `OrderTimestampField`
 * literals. It is still written through Prisma's typed `update` rather than raw
 * SQL, so it is not string-built at all.
 */
export async function setStatus(
  tx: Tx,
  orderId: string,
  to: OrderStatus,
  stamps: OrderTimestampField | null,
  at: Date,
): Promise<void> {
  await auditedExecutor(tx).order.update({
    where: { id: orderId },
    data: { status: to, ...(stamps === null ? {} : { [stamps]: at }) },
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

/** Is this human-facing order number already committed? */
export async function orderNumberTaken(tx: Tx, candidate: string): Promise<boolean> {
  const found = await auditedExecutor(tx).order.findUnique({
    where: { orderNumber: candidate },
    select: { id: true },
  });
  return found !== null;
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
