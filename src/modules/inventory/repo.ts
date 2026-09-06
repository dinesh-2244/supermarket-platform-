/**
 * Prisma / SQL access for `inventory`. Private to this module: nothing outside
 * `src/modules/inventory` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * Repository functions take a `DbExecutor` so a caller inside a transaction can
 * pass its `Tx` handle and keep a write and its audit row in one commit (§17).
 */
import { getPrisma, type DbExecutor } from '../platform/index';

/** The executor to run a query on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}
