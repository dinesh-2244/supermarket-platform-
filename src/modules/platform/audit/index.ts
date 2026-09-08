import type { Tx } from '../db/index';
import type { Principal } from '../authz/index';

/**
 * The generic sensitive-mutation trail (arch §21): who changed what, from what,
 * to what.
 *
 * **Why this lives in the kernel.** Architecture §4 assigns `AuditLog` to no
 * module — every module writes it, and `admin` only reads it. A per-module copy
 * of "shape the before/after JSON and insert a row" would be six near-identical
 * blocks and would make "every sensitive mutation is audited" impossible to
 * verify in one place. So it sits beside the logger, as infrastructure.
 *
 * **Why it demands a `Tx`.** The audit row has to commit with the change it
 * describes, exactly like `StockLedger` and `PriceChange`. The branded handle
 * (only `withTransaction` can mint one) makes "audited after the fact, in its
 * own transaction, possibly not at all" a compile error rather than a habit.
 */
export type AuditAction =
  | 'create'
  | 'update'
  | 'disable'
  | 'enable'
  | 'reset-password'
  | 'adjust'
  | 'reconcile'
  | 'import'
  | 'set-price'
  | 'list'
  | 'unlist';

export interface AuditEntry {
  /** Who acted. `system` and customers are recorded as such, never as a user. */
  readonly principal: Principal;
  readonly action: AuditAction;
  readonly entityType: string;
  readonly entityId: string;
  /**
   * The store this change belonged to **at the time it happened**, or `null` for
   * a genuinely global one (the catalogue master, a super-admin account).
   *
   * Stamped here and never updated. Deriving it later from the actor's *current*
   * store meant transferring a manager between stores retro-assigned their whole
   * history to the new store, and handed that store's colleagues the old store's
   * audit rows.
   */
  readonly storeId?: string | null;
  /** State before the change — omit on create. */
  readonly before?: unknown;
  /** State after the change — omit on a pure delete. */
  readonly after?: unknown;
  readonly ip?: string | null;
}

type ActorType = 'USER' | 'CUSTOMER' | 'SYSTEM';

function actorOf(principal: Principal): { actorType: ActorType; actorId: string | null } {
  switch (principal.kind) {
    case 'user':
      return { actorType: 'USER', actorId: principal.userId };
    case 'customer':
      return { actorType: 'CUSTOMER', actorId: principal.customerId };
    case 'system':
      return { actorType: 'SYSTEM', actorId: null };
  }
}

/**
 * `undefined` and a Prisma `Decimal`-ish value are not JSON; `null` is, and is
 * what the column means by "nothing recorded". Serialising through JSON also
 * makes the snapshot a *copy* — a later mutation of the same object cannot
 * rewrite history.
 */
function snapshot(value: unknown): unknown {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** Write one audit row inside the caller's transaction. */
export async function writeAuditLog(tx: Tx, entry: AuditEntry): Promise<void> {
  const { actorType, actorId } = actorOf(entry.principal);

  await tx.auditLog.create({
    data: {
      actorType,
      actorId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      storeId: entry.storeId ?? null,
      beforeJson: snapshot(entry.before) as never,
      afterJson: snapshot(entry.after) as never,
      ip: entry.ip ?? null,
    },
  });
}
