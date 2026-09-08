/**
 * Prisma access for `admin`. Private to this module: nothing outside
 * `src/modules/admin` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * `admin` owns no tables. The one query here reads `AuditLog`, which architecture
 * §4 assigns to no module — every module writes it through the kernel helper and
 * only the back office reads it, so the read-model lives with the screen that
 * needs it rather than being duplicated into six modules.
 */
import { getPrisma, type DbExecutor } from '../platform/index';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

export interface AuditEntryRecord {
  readonly id: string;
  readonly storeId: string | null;
  readonly actorType: 'USER' | 'CUSTOMER' | 'SYSTEM';
  readonly actorId: string | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly beforeJson: unknown;
  readonly afterJson: unknown;
  readonly createdAt: Date;
}

export interface AuditQuery {
  readonly entityType?: string;
  readonly actorId?: string;
  readonly from?: Date;
  readonly to?: Date;
  readonly limit?: number;
  /**
   * `null` means every store (a super-admin). An array restricts to those
   * stores' entries — applied **in SQL, before the limit**.
   */
  readonly storeIds?: readonly string[] | null;
}

/**
 * Newest first. Read-only — nothing in Phase 2 updates or deletes an entry.
 *
 * The store restriction is part of the query rather than a filter applied to the
 * results, for two reasons. It has to use the **immutable** `storeId` stamped on
 * each row, not the actor's current assignment — otherwise transferring a
 * manager between stores hands their new colleagues the old store's history. And
 * filtering after a `LIMIT` silently drops legitimate rows whenever the newest N
 * entries globally happen to belong to another store, which is exactly what a
 * busy second store causes.
 */
export async function listAuditEntries(
  query: AuditQuery,
  db?: DbExecutor,
): Promise<readonly AuditEntryRecord[]> {
  const stores = query.storeIds;
  return executor(db).auditLog.findMany({
    where: {
      ...(query.entityType !== undefined ? { entityType: query.entityType } : {}),
      ...(query.actorId !== undefined ? { actorId: query.actorId } : {}),
      // A scoped principal sees their own stores' entries. Global rows
      // (storeId null — the catalogue master) stay visible to super-admins only:
      // they are not "no store", they are "every store".
      ...(stores == null ? {} : { storeId: { in: [...stores] } }),
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
    take: query.limit ?? 100,
  });
}
