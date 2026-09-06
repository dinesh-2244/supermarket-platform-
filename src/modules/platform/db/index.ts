import { Prisma, PrismaClient } from '@prisma/client';
import { getConfig } from '../config/index.js';
import { childLogger } from '../logger/index.js';

/**
 * A transaction handle. Every write that must be audited (`websiteStock` →
 * `StockLedger`, `Order.status` → `OrderStatusHistory`) takes one of these, so
 * the audit row cannot be written outside its transaction (§3/§17).
 */
export type Tx = Prisma.TransactionClient;

/** Anything that can run a query: the singleton client or a transaction handle. */
export type DbExecutor = PrismaClient | Tx;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const config = getConfig();
  return new PrismaClient({
    datasources: { db: { url: config.DATABASE_URL } },
    log: config.APP_ENV === 'local' ? ['warn', 'error'] : ['error'],
  });
}

/**
 * The process-wide Prisma client. Cached on `globalThis` so Next.js dev-server
 * hot reloads do not open a new connection pool on every edit.
 */
export function getPrisma(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

export interface TransactionOptions {
  /** Milliseconds a transaction may run before Prisma rolls it back. */
  readonly timeoutMs?: number;
  /** Milliseconds to wait for a connection before giving up. */
  readonly maxWaitMs?: number;
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Run `fn` inside one database transaction.
 *
 * The handle is passed *in* rather than read from ambient state: a caller that
 * wants to write a `StockLedger` row has to thread `tx` through, which is what
 * keeps "stock change and its audit row commit together" easy to hold.
 */
export function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return getPrisma().$transaction(fn, {
    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    ...(options.maxWaitMs !== undefined ? { maxWait: options.maxWaitMs } : {}),
    ...(options.isolationLevel !== undefined ? { isolationLevel: options.isolationLevel } : {}),
  });
}

export interface LockedInventoryRow {
  readonly id: string;
  readonly storeId: string;
  readonly productId: string;
  readonly websiteStock: number;
}

/**
 * Take a row-level write lock on one store's stock row (§7, ADR-0005).
 *
 * This is the one raw-SQL carve-out in the codebase: Prisma has no `FOR UPDATE`.
 * It *requires* a transaction handle because a lock taken outside a transaction
 * is released immediately and would silently do nothing. Returns `null` when no
 * inventory row exists for the pair.
 */
export async function selectForUpdate(
  tx: Tx,
  storeId: string,
  productId: string,
): Promise<LockedInventoryRow | null> {
  const rows = await tx.$queryRaw<LockedInventoryRow[]>`
    SELECT "id", "storeId", "productId", "websiteStock"
    FROM "InventoryItem"
    WHERE "storeId" = ${storeId} AND "productId" = ${productId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

/** Lock several stock rows at once, ordered by id to avoid deadlocking. */
export async function selectManyForUpdate(
  tx: Tx,
  storeId: string,
  productIds: readonly string[],
): Promise<readonly LockedInventoryRow[]> {
  if (productIds.length === 0) return [];
  return tx.$queryRaw<LockedInventoryRow[]>`
    SELECT "id", "storeId", "productId", "websiteStock"
    FROM "InventoryItem"
    WHERE "storeId" = ${storeId} AND "productId" IN (${Prisma.join(productIds)})
    ORDER BY "id"
    FOR UPDATE
  `;
}

export interface DbHealth {
  readonly db: 'ok' | 'down';
  readonly migrations: 'current' | 'pending' | 'unknown';
}

/**
 * Connectivity + migration state for `/api/health`. Never throws: a down
 * database must be *reported*, not crash the health endpoint.
 */
export async function checkDbHealth(): Promise<DbHealth> {
  const prisma = getPrisma();
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    childLogger('db').error({ err: error }, 'Database health check failed');
    return { db: 'down', migrations: 'unknown' };
  }

  try {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "_prisma_migrations"
      WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL
    `;
    const pending = Number(rows[0]?.count ?? 0n);
    return { db: 'ok', migrations: pending === 0 ? 'current' : 'pending' };
  } catch (error) {
    // No `_prisma_migrations` table yet — the database is reachable but has
    // never been migrated.
    childLogger('db').warn({ err: error }, 'Could not read migration state');
    return { db: 'ok', migrations: 'pending' };
  }
}

export { Prisma };
