/**
 * Prisma access for `product-requests`. Private to this module: nothing outside
 * `src/modules/product-requests` may import this file, and
 * `import/no-restricted-paths` enforces that.
 *
 * Reads take a `DbExecutor`; the writes that must land together (the request
 * and its opening history row; a status change, its history row and its audit
 * row) take the branded `Tx` only, so they cannot be run outside a transaction.
 */
import {
  getPrisma,
  scopedWhere,
  type DbExecutor,
  type Principal,
  type Tx,
} from '../platform/index';
import type { ProductRequestStatus, Submission } from './domain/index';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

/** The executor to run an *audited write* on — a `Tx`, never the root client. */
export function auditedExecutor(tx: Tx): Tx {
  return tx;
}

export interface ProductRequestRow {
  readonly id: string;
  readonly storeId: string;
  readonly productName: string;
  readonly brand: string | null;
  readonly packSize: string | null;
  readonly note: string | null;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly status: ProductRequestStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface ProductRequestHistoryRow {
  readonly fromStatus: ProductRequestStatus | null;
  readonly toStatus: ProductRequestStatus;
  readonly actorType: 'USER' | 'CUSTOMER' | 'SYSTEM';
  readonly actorId: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
}

const requestSelect = {
  id: true,
  storeId: true,
  productName: true,
  brand: true,
  packSize: true,
  note: true,
  customerName: true,
  customerPhone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const historySelect = {
  fromStatus: true,
  toStatus: true,
  actorType: true,
  actorId: true,
  note: true,
  createdAt: true,
} as const;

export interface HistoryEntry {
  readonly requestId: string;
  readonly fromStatus: ProductRequestStatus | null;
  readonly toStatus: ProductRequestStatus;
  readonly actorType: 'USER' | 'CUSTOMER' | 'SYSTEM';
  readonly actorId: string | null;
  readonly note: string | null;
}

/** The request row and its opening `NEW` history row, in the caller's transaction. */
export async function insertRequest(
  tx: Tx,
  storeId: string,
  submission: Submission,
  keys: { productKey: string; submitterKey: string },
  actor: { actorType: 'CUSTOMER'; actorId: string | null },
): Promise<ProductRequestRow> {
  const row = await auditedExecutor(tx).productRequest.create({
    data: { storeId, ...submission, ...keys },
    select: requestSelect,
  });
  await insertHistory(tx, {
    requestId: row.id,
    fromStatus: null,
    toStatus: 'NEW',
    actorType: actor.actorType,
    actorId: actor.actorId,
    note: null,
  });
  return row;
}

/** Append-only, and written in the same transaction as the status change. */
export async function insertHistory(tx: Tx, entry: HistoryEntry): Promise<void> {
  await auditedExecutor(tx).productRequestStatusHistory.create({ data: entry });
}

/**
 * The request row, locked for the rest of the transaction — so two managers
 * triaging the same request at once cannot both read `NEW` and both write a
 * first step. Raw SQL because Prisma has no `FOR UPDATE`.
 */
export async function lockRequest(tx: Tx, requestId: string): Promise<ProductRequestRow | null> {
  const rows = await auditedExecutor(tx).$queryRaw<ProductRequestRow[]>`
    SELECT "id", "storeId", "productName", "brand", "packSize", "note",
           "customerName", "customerPhone", "status", "createdAt", "updatedAt"
    FROM "ProductRequest"
    WHERE "id" = ${requestId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function setStatus(
  tx: Tx,
  requestId: string,
  status: ProductRequestStatus,
): Promise<ProductRequestRow> {
  return auditedExecutor(tx).productRequest.update({
    where: { id: requestId },
    data: { status },
    select: requestSelect,
  });
}

/**
 * Requests this principal may see in `storeId`, newest first.
 *
 * The store scope is applied **here**, not by the caller: a list that forgets
 * it is store-bound is an IDOR, and the query is the one place it cannot be
 * forgotten.
 */
export async function listForPrincipal(
  db: DbExecutor,
  principal: Principal,
  storeId: string,
  filter: { statuses?: readonly ProductRequestStatus[]; limit?: number },
): Promise<ProductRequestRow[]> {
  return executor(db).productRequest.findMany({
    where: scopedWhere(principal, {
      storeId,
      ...(filter.statuses === undefined || filter.statuses.length === 0
        ? {}
        : { status: { in: [...filter.statuses] } }),
    }),
    select: requestSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: filter.limit ?? 200,
  });
}

/** One request with its history — by id **and** scope, never by id alone. */
export async function findForPrincipal(
  db: DbExecutor,
  principal: Principal,
  requestId: string,
): Promise<(ProductRequestRow & { readonly history: readonly ProductRequestHistoryRow[] }) | null> {
  const row = await executor(db).productRequest.findFirst({
    where: scopedWhere(principal, { id: requestId }),
    select: {
      ...requestSelect,
      statusHistory: { select: historySelect, orderBy: { createdAt: 'asc' } },
    },
  });
  if (row === null) return null;
  const { statusHistory, ...request } = row;
  return { ...request, history: statusHistory };
}

/** Exact counts per status — a `COUNT … GROUP BY`, never a counted list. */
export async function countByStatus(
  db: DbExecutor,
  principal: Principal,
  storeId: string,
): Promise<{ status: ProductRequestStatus; count: number }[]> {
  const rows = await executor(db).productRequest.groupBy({
    by: ['status'],
    where: scopedWhere(principal, { storeId }),
    _count: { _all: true },
  });
  return rows.map((row) => ({ status: row.status, count: row._count._all }));
}

// ---------------------------------------------------------------------------
// Intake caps — read inside the store's intake lock, so the count and the
// insert that follows it cannot interleave with another submission's.
// ---------------------------------------------------------------------------

export async function countRecentForStore(tx: Tx, storeId: string, since: Date): Promise<number> {
  return auditedExecutor(tx).productRequest.count({
    where: { storeId, createdAt: { gte: since } },
  });
}

export async function countRecentForSubmitter(
  tx: Tx,
  storeId: string,
  submitterKey: string,
  since: Date,
): Promise<number> {
  return auditedExecutor(tx).productRequest.count({
    where: { storeId, submitterKey, createdAt: { gte: since } },
  });
}

export async function hasRecentDuplicate(
  tx: Tx,
  storeId: string,
  submitterKey: string,
  productKey: string,
  since: Date,
): Promise<boolean> {
  const row = await auditedExecutor(tx).productRequest.findFirst({
    where: { storeId, submitterKey, productKey, createdAt: { gte: since } },
    select: { id: true },
  });
  return row !== null;
}
