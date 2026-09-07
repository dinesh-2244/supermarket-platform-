/**
 * Prisma / SQL access for `identity`. Private to this module: nothing outside
 * `src/modules/identity` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * Read helpers take a `DbExecutor` so a caller inside a transaction can pass its
 * `Tx` handle and see its own uncommitted writes. Audited writes take a `Tx` and
 * nothing else — see `auditedExecutor` (§17).
 */
import {
  getPrisma,
  storeScopeFilter,
  type DbExecutor,
  type Principal,
  type Tx,
  type UserRole,
} from '../platform/index';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

/**
 * The executor to run an *audited write* on.
 *
 * Deliberately has no `getPrisma()` fallback and takes the branded `Tx` that
 * only `withTransaction` can mint: a user mutation without its `AuditLog` row in
 * the same commit is the failure mode §3/§17 exists to prevent. Passing the root
 * client here is a compile error, not a silent single-statement transaction.
 */
export function auditedExecutor(tx: Tx): Tx {
  return tx;
}

/** Columns safe to return from a list — never `passwordHash` or `twoFactorSecret`. */
const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  storeId: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: UserRole;
  readonly storeId: string | null;
  readonly isActive: boolean;
  readonly lastLoginAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export async function findById(id: string, db?: DbExecutor): Promise<UserRecord | null> {
  return executor(db).user.findUnique({ where: { id }, select: publicUserSelect });
}

/** Includes the hash — only the credentials check may call this. */
export async function findByEmailWithSecret(
  email: string,
  db?: DbExecutor,
): Promise<(UserRecord & { passwordHash: string }) | null> {
  return executor(db).user.findUnique({
    where: { email },
    select: { ...publicUserSelect, passwordHash: true },
  });
}

/**
 * List users the principal may see.
 *
 * The scope filter is applied here rather than by the caller: a store-bound list
 * that forgets it is an IDOR, so the only query in the module is the filtered
 * one. `SUPER_ADMIN`s have no `storeId`, so a scoped principal never sees them.
 */
export async function listVisibleUsers(
  principal: Principal,
  db?: DbExecutor,
): Promise<readonly UserRecord[]> {
  return executor(db).user.findMany({
    where: storeScopeFilter(principal),
    select: publicUserSelect,
    orderBy: [{ isActive: 'desc' }, { email: 'asc' }],
  });
}

export interface CreateUserRow {
  readonly email: string;
  readonly name: string;
  readonly passwordHash: string;
  readonly role: UserRole;
  readonly storeId: string | null;
}

export async function insertUser(tx: Tx, row: CreateUserRow): Promise<UserRecord> {
  return auditedExecutor(tx).user.create({ data: { ...row }, select: publicUserSelect });
}

export interface UpdateUserRow {
  readonly name?: string;
  readonly role?: UserRole;
  readonly storeId?: string | null;
  readonly isActive?: boolean;
  readonly passwordHash?: string;
}

export async function updateUser(tx: Tx, id: string, row: UpdateUserRow): Promise<UserRecord> {
  return auditedExecutor(tx).user.update({
    where: { id },
    data: { ...row },
    select: publicUserSelect,
  });
}

export async function touchLastLogin(id: string, db?: DbExecutor): Promise<void> {
  await executor(db).user.update({ where: { id }, data: { lastLoginAt: new Date() } });
}

/**
 * Drop every session a user holds.
 *
 * Called on disable, role/store change and password reset: a live cookie must
 * not outlive the authority it was issued under. Returns how many were killed so
 * the caller can record it.
 */
export async function deleteSessionsForUser(tx: Tx, userId: string): Promise<number> {
  const { count } = await auditedExecutor(tx).session.deleteMany({ where: { userId } });
  return count;
}

export async function countActiveSuperAdmins(db?: DbExecutor): Promise<number> {
  return executor(db).user.count({ where: { role: 'SUPER_ADMIN', isActive: true } });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionRow {
  readonly id: string;
  readonly sessionToken: string;
  readonly userId: string;
  readonly expires: Date;
}

export async function insertSession(
  sessionToken: string,
  userId: string,
  expires: Date,
  db?: DbExecutor,
): Promise<SessionRow> {
  return executor(db).session.create({ data: { sessionToken, userId, expires } });
}

/** The session and the user behind it, or `null` if either is gone. */
export async function findSessionWithUser(
  sessionToken: string,
  db?: DbExecutor,
): Promise<{ session: SessionRow; user: UserRecord } | null> {
  const row = await executor(db).session.findUnique({
    where: { sessionToken },
    select: {
      id: true,
      sessionToken: true,
      userId: true,
      expires: true,
      user: { select: publicUserSelect },
    },
  });
  if (row === null) return null;
  const { user, ...session } = row;
  return { session, user };
}

export async function deleteSession(sessionToken: string, db?: DbExecutor): Promise<void> {
  await executor(db).session.deleteMany({ where: { sessionToken } });
}

/** Housekeeping: drop rows whose absolute lifetime has run out. */
export async function deleteExpiredSessions(now: Date, db?: DbExecutor): Promise<number> {
  const { count } = await executor(db).session.deleteMany({ where: { expires: { lt: now } } });
  return count;
}
