import { Prisma, PrismaClient } from '@prisma/client';
import { getConfig } from '../config/index';
import { childLogger } from '../logger/index';
import { EXPECTED_MIGRATIONS } from './expected-migrations';

declare const transactionHandle: unique symbol;

/**
 * A transaction handle, and *only* a transaction handle.
 *
 * `Prisma.TransactionClient` on its own is structurally compatible with
 * `PrismaClient` (it is a plain `Omit<>`), so a bare `getPrisma()` used to
 * typecheck everywhere a transaction was demanded — which quietly turned
 * `SELECT … FOR UPDATE` into a lock released one statement later. The brand is
 * unforgeable outside this file, so the only way to obtain a `Tx` is from
 * {@link withTransaction}. Every write that must be audited (`websiteStock` →
 * `StockLedger`, `Order.status` → `OrderStatusHistory`) takes one, so the audit
 * row cannot be written outside its transaction (§3/§17).
 */
export type Tx = Prisma.TransactionClient & { readonly [transactionHandle]: true };

/** Anything that can run a *read*: the singleton client or a transaction handle. */
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
 * keeps "stock change and its audit row commit together" easy to hold. This is
 * the only place a {@link Tx} is minted.
 */
export function withTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  return getPrisma().$transaction((tx) => fn(asTx(tx)), {
    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
    ...(options.maxWaitMs !== undefined ? { maxWait: options.maxWaitMs } : {}),
    ...(options.isolationLevel !== undefined ? { isolationLevel: options.isolationLevel } : {}),
  });
}

/**
 * The lock namespaces. One `classid` per invariant, so two unrelated rules never
 * contend and a collision within one is deliberate.
 *
 * PostgreSQL advisory locks are a flat 64-bit space with no schema behind them,
 * which makes an ad-hoc integer at a call site exactly the kind of thing that
 * silently stops locking when somebody picks the same number elsewhere. Naming
 * them here is the whole defence.
 */
export const LOCK_NAMESPACE = {
  /** One shopper's address book: which of their addresses is the default. */
  customerAddresses: 0x0_11_58,
  /** One shopper's carts: at most one of them is `ACTIVE`. */
  customerCarts: 0x0_11_59,
  /**
   * One store's delivery slot: how many orders that window already holds.
   *
   * The rule is about a *set* of orders, and the order about to join it does not
   * exist yet, so no row lock can serialise it: two placements would each count
   * the same N and each commit the N+1st. The key is `(storeId, slotStart)`.
   */
  deliverySlot: 0x0_11_5a,
} as const;

export type LockNamespace = (typeof LOCK_NAMESPACE)[keyof typeof LOCK_NAMESPACE];

/**
 * Serialise a *rule about a set of rows* on the key those rows share.
 *
 * A row lock protects a row. It does nothing at all for an invariant spanning
 * rows that do not exist yet: two transactions each inserting a new default
 * address, or each adopting a different cart, lock different rows, read the
 * other's not-yet-committed work as absent, and both commit — leaving two
 * defaults or two active carts (R2, R3). There is no row whose lock they would
 * contend for, so the lock has to be on the *key* instead.
 *
 * Transaction-scoped, so it is released on commit or rollback and a failure
 * cannot strand it. `hashtext` collisions make two unrelated shoppers briefly
 * serial and never incorrect. The cast to `int` is required: Prisma binds a
 * tagged-template number as `bigint`, and `pg_advisory_xact_lock(bigint, int)`
 * does not exist.
 */
export async function advisoryXactLock(
  tx: Tx,
  namespace: LockNamespace,
  key: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${namespace}::int, hashtext(${key}))`;
}

function asTx(client: Prisma.TransactionClient): Tx {
  return client as Tx;
}

/**
 * Belt-and-braces for the type brand: refuse a root client at runtime too.
 *
 * Prisma's interactive-transaction proxy deliberately omits `$transaction` and
 * `$connect`, so their presence is a reliable "this is the singleton client"
 * signal — and catches anyone who reached for `as unknown as Tx`.
 */
export function assertTransactionHandle(candidate: DbExecutor): asserts candidate is Tx {
  const suspect = candidate as Partial<PrismaClient>;
  if (typeof suspect.$transaction === 'function' || typeof suspect.$connect === 'function') {
    throw new Error(
      'Expected a transaction handle from withTransaction(), got the root Prisma client. ' +
        'A row lock or audited write taken outside a transaction is released immediately.',
    );
  }
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
  assertTransactionHandle(tx);
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
  assertTransactionHandle(tx);
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

/** One row of Prisma's `_prisma_migrations` bookkeeping table. */
export interface MigrationAttempt {
  readonly name: string;
  readonly finished: boolean;
  readonly rolledBack: boolean;
}

/**
 * Decide whether the database carries every migration this build ships with.
 *
 * Counting *incomplete* rows is not enough: an empty `_prisma_migrations` table
 * (a fresh or wrong schema) has zero incomplete rows, and a migration that has
 * never been attempted has no row at all — both used to report `current`.
 * Compare identities instead, in both directions that matter:
 *
 * - an expected migration with no successful attempt → `pending`;
 * - an attempt still running or failed part-way → `pending`;
 * - a row that was rolled back and then re-applied → the later successful
 *   attempt satisfies it, so `current`;
 * - migrations in the database this build does not know about → not our
 *   problem to report here (the database is ahead, the app still runs).
 */
export function evaluateMigrationState(
  attempts: readonly MigrationAttempt[],
  expected: readonly string[] = EXPECTED_MIGRATIONS,
): DbHealth['migrations'] {
  const succeeded = new Set(attempts.filter((a) => a.finished && !a.rolledBack).map((a) => a.name));
  const missing = expected.filter((name) => !succeeded.has(name));
  const unresolved = attempts.filter((a) => !a.finished && !a.rolledBack);

  return missing.length === 0 && unresolved.length === 0 ? 'current' : 'pending';
}

/** Read every recorded migration attempt. Throws when the table is absent. */
export async function readMigrationAttempts(
  db: DbExecutor = getPrisma(),
): Promise<readonly MigrationAttempt[]> {
  return db.$queryRaw<MigrationAttempt[]>`
    SELECT "migration_name"                  AS "name",
           "finished_at"    IS NOT NULL      AS "finished",
           "rolled_back_at" IS NOT NULL      AS "rolledBack"
    FROM "_prisma_migrations"
  `;
}

/**
 * Connectivity + migration state for `/api/health`. Never throws: a down
 * database must be *reported*, not crash the health endpoint. The client is a
 * parameter so a test can point it at something unreachable.
 */
export async function checkDbHealth(client: PrismaClient = getPrisma()): Promise<DbHealth> {
  try {
    await client.$queryRaw`SELECT 1`;
  } catch (error) {
    childLogger('db').error({ err: error }, 'Database health check failed');
    return { db: 'down', migrations: 'unknown' };
  }

  try {
    return { db: 'ok', migrations: evaluateMigrationState(await readMigrationAttempts(client)) };
  } catch (error) {
    // No `_prisma_migrations` table yet — the database is reachable but has
    // never been migrated.
    childLogger('db').warn({ err: error }, 'Could not read migration state');
    return { db: 'ok', migrations: 'pending' };
  }
}

export { EXPECTED_MIGRATIONS };
export { Prisma };
