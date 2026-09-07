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
}

/** Newest first. Read-only — nothing in Phase 2 updates or deletes an entry. */
export async function listAuditEntries(
  query: AuditQuery,
  db?: DbExecutor,
): Promise<readonly AuditEntryRecord[]> {
  return executor(db).auditLog.findMany({
    where: {
      ...(query.entityType !== undefined ? { entityType: query.entityType } : {}),
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
    take: query.limit ?? 100,
  });
}

/** The actor ids a scoped principal is allowed to see entries for. */
export async function userIdsForStores(
  storeIds: readonly string[],
  db?: DbExecutor,
): Promise<readonly string[]> {
  const rows = await executor(db).user.findMany({
    where: { storeId: { in: [...storeIds] } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
