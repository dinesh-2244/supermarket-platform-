/**
 * Prisma / SQL access for `inventory`. Private to this module: nothing outside
 * `src/modules/inventory` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * Read helpers take a `DbExecutor` so a caller inside a transaction can pass its
 * `Tx` handle and see its own uncommitted writes. The stock write takes a `Tx`
 * and nothing else — see `auditedExecutor` (§17).
 */
import {
  getPrisma,
  selectForUpdate,
  storeScopeFilter,
  type DbExecutor,
  type LockedInventoryRow,
  type Principal,
  type Tx,
} from '../platform/index';
import type { StockReason } from './domain/index';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

/**
 * The executor to run an *audited write* on.
 *
 * Deliberately has no `getPrisma()` fallback and takes the branded `Tx` that
 * only `withTransaction` can mint. This is the invariant the whole module exists
 * to protect: a `websiteStock` change without its `StockLedger` row in the same
 * commit (§3/§7). Passing the root client here is a compile error, not a silent
 * single-statement transaction.
 */
export function auditedExecutor(tx: Tx): Tx {
  return tx;
}

export interface InventoryRecord {
  readonly id: string;
  readonly storeId: string;
  readonly productId: string;
  readonly websiteStock: number;
  readonly lastCountedAt: Date | null;
  readonly updatedAt: Date;
}

export interface LedgerRecord {
  readonly id: string;
  readonly storeId: string;
  readonly productId: string;
  readonly delta: number;
  readonly reason: StockReason;
  readonly refType: string | null;
  readonly refId: string | null;
  readonly balanceAfter: number;
  readonly actorType: 'USER' | 'CUSTOMER' | 'SYSTEM';
  readonly actorId: string | null;
  readonly note: string | null;
  readonly createdAt: Date;
}

const itemSelect = {
  id: true,
  storeId: true,
  productId: true,
  websiteStock: true,
  lastCountedAt: true,
  updatedAt: true,
} as const;

/**
 * Take the row-level write lock for a stock mutation.
 *
 * Re-exported from `platform/db` so this module has one obvious door: every
 * mutation goes through it, and `SELECT … FOR UPDATE` is what makes two
 * concurrent adjust/reconcile/import operations on the same item serialise
 * instead of both reading the same balance and both writing it.
 */
export async function lockItem(
  tx: Tx,
  storeId: string,
  productId: string,
): Promise<LockedInventoryRow | null> {
  return selectForUpdate(tx, storeId, productId);
}

export async function findItem(
  storeId: string,
  productId: string,
  db?: DbExecutor,
): Promise<InventoryRecord | null> {
  return executor(db).inventoryItem.findUnique({
    where: { storeId_productId: { storeId, productId } },
    select: itemSelect,
  });
}

/** Create the row on first touch, so a never-stocked product can be adjusted. */
export async function ensureItem(
  tx: Tx,
  storeId: string,
  productId: string,
): Promise<InventoryRecord> {
  return auditedExecutor(tx).inventoryItem.upsert({
    where: { storeId_productId: { storeId, productId } },
    update: {},
    create: { storeId, productId, websiteStock: 0 },
    select: itemSelect,
  });
}

export async function setStock(
  tx: Tx,
  id: string,
  websiteStock: number,
  lastCountedAt?: Date,
): Promise<InventoryRecord> {
  return auditedExecutor(tx).inventoryItem.update({
    where: { id },
    data: {
      websiteStock,
      ...(lastCountedAt !== undefined ? { lastCountedAt } : {}),
    },
    select: itemSelect,
  });
}

export interface LedgerRow {
  readonly storeId: string;
  readonly productId: string;
  readonly delta: number;
  readonly reason: StockReason;
  readonly balanceAfter: number;
  readonly actorType: 'USER' | 'CUSTOMER' | 'SYSTEM';
  readonly actorId: string | null;
  readonly refType?: string | null;
  readonly refId?: string | null;
  readonly note?: string | null;
}

/** Append-only. Written in the same transaction as the balance it records. */
export async function insertLedger(tx: Tx, row: LedgerRow): Promise<LedgerRecord> {
  return auditedExecutor(tx).stockLedger.create({
    data: {
      storeId: row.storeId,
      productId: row.productId,
      delta: row.delta,
      reason: row.reason,
      balanceAfter: row.balanceAfter,
      actorType: row.actorType,
      actorId: row.actorId,
      refType: row.refType ?? null,
      refId: row.refId ?? null,
      note: row.note ?? null,
    },
  });
}

/**
 * Stock rows the principal may see. The scope filter lives here rather than in
 * the caller: a store-bound list that forgets it is an IDOR.
 */
export async function listItems(
  principal: Principal,
  options: { storeId?: string; productIds?: readonly string[]; limit?: number },
  db?: DbExecutor,
): Promise<readonly InventoryRecord[]> {
  return executor(db).inventoryItem.findMany({
    where: {
      ...storeScopeFilter(principal),
      ...(options.storeId !== undefined ? { storeId: options.storeId } : {}),
      ...(options.productIds !== undefined ? { productId: { in: [...options.productIds] } } : {}),
    },
    select: itemSelect,
    orderBy: [{ storeId: 'asc' }, { productId: 'asc' }],
    take: options.limit ?? 500,
  });
}

/** Items at or below the store's threshold, scarcest first. */
export async function listLowStock(
  principal: Principal,
  storeId: string,
  threshold: number,
  limit: number,
  db?: DbExecutor,
): Promise<readonly InventoryRecord[]> {
  return executor(db).inventoryItem.findMany({
    where: {
      ...storeScopeFilter(principal),
      storeId,
      websiteStock: { lte: threshold },
    },
    select: itemSelect,
    orderBy: [{ websiteStock: 'asc' }, { productId: 'asc' }],
    take: limit,
  });
}

export interface LedgerQuery {
  readonly storeId: string;
  readonly productId?: string;
  readonly reasons?: readonly StockReason[];
  readonly from?: Date;
  readonly to?: Date;
  readonly actorId?: string;
  readonly limit?: number;
}

/** Newest first — the ledger is read as "what happened lately". */
export async function listLedger(
  principal: Principal,
  query: LedgerQuery,
  db?: DbExecutor,
): Promise<readonly LedgerRecord[]> {
  return executor(db).stockLedger.findMany({
    where: {
      ...storeScopeFilter(principal),
      storeId: query.storeId,
      ...(query.productId !== undefined ? { productId: query.productId } : {}),
      ...(query.reasons !== undefined ? { reason: { in: [...query.reasons] } } : {}),
      ...(query.actorId !== undefined ? { actorId: query.actorId } : {}),
      ...(query.from !== undefined || query.to !== undefined
        ? {
            createdAt: {
              ...(query.from !== undefined ? { gte: query.from } : {}),
              ...(query.to !== undefined ? { lte: query.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: query.limit ?? 200,
  });
}

// ---------------------------------------------------------------------------
// Import history (D6)
// ---------------------------------------------------------------------------

export interface ImportRunRecord {
  readonly id: string;
  readonly storeId: string;
  readonly filename: string;
  readonly mode: string;
  readonly outcome: string;
  readonly rowCount: number;
  readonly appliedCount: number;
  readonly errorCount: number;
  readonly errorsJson: unknown;
  readonly actorUserId: string | null;
  readonly createdAt: Date;
}

export interface InsertImportRun {
  readonly storeId: string;
  readonly filename: string;
  readonly mode: string;
  readonly outcome: string;
  readonly rowCount: number;
  readonly appliedCount: number;
  readonly errorCount: number;
  readonly errors: readonly unknown[];
  readonly actorUserId: string | null;
}

/**
 * Recorded for a rejected run as well as an applied one: a refused import plus
 * its per-row errors is exactly what the operator needs in order to fix the
 * file, and it is the only record that the attempt happened at all.
 */
export async function insertImportRun(
  row: InsertImportRun,
  db?: DbExecutor,
): Promise<ImportRunRecord> {
  return executor(db).inventoryImport.create({
    data: {
      storeId: row.storeId,
      filename: row.filename,
      mode: row.mode,
      outcome: row.outcome,
      rowCount: row.rowCount,
      appliedCount: row.appliedCount,
      errorCount: row.errorCount,
      errorsJson: row.errors as never,
      actorUserId: row.actorUserId,
    },
  });
}

export async function listImportRuns(
  principal: Principal,
  storeId: string,
  limit: number,
  db?: DbExecutor,
): Promise<readonly ImportRunRecord[]> {
  return executor(db).inventoryImport.findMany({
    where: { ...storeScopeFilter(principal), storeId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/** Stamp the final applied count once the batch is known. */
export async function updateImportRunCounts(
  tx: Tx,
  id: string,
  appliedCount: number,
): Promise<ImportRunRecord> {
  return auditedExecutor(tx).inventoryImport.update({
    where: { id },
    data: { appliedCount },
  });
}

export async function findImportRun(id: string, db?: DbExecutor): Promise<ImportRunRecord | null> {
  return executor(db).inventoryImport.findUnique({ where: { id } });
}
