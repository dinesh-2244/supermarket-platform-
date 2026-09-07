/**
 * Prisma / SQL access for `checkout`. Private to this module: nothing outside
 * `src/modules/checkout` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * Read helpers take a `DbExecutor` so a caller inside a transaction can pass its
 * `Tx` handle and see its own uncommitted writes. Audited writes take a `Tx` and
 * nothing else — see `auditedExecutor` (§17).
 */
import { getPrisma, type DbExecutor, type Tx } from '../platform/index';

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
