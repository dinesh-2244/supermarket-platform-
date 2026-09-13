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
  scopedWhere,
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

/**
 * Whether a user has enrolled a second factor, and the secret if so.
 *
 * Read separately from `publicUserSelect` on purpose: the secret is a
 * credential, and a column that is never in the shape a screen renders cannot
 * be leaked by a screen. Only the sign-in and enrolment paths call this.
 */
export async function findTwoFactorSecret(userId: string, db?: DbExecutor): Promise<string | null> {
  const row = await executor(db).user.findUnique({
    where: { id: userId },
    select: { twoFactorSecret: true },
  });
  return row?.twoFactorSecret ?? null;
}

/**
 * Store a second factor, but **only** on an account that has none.
 *
 * The `twoFactorSecret: null` in the where-clause is the guard, not a
 * convenience: it makes enrolment a compare-and-set that the database
 * arbitrates, so two confirms racing on the same account cannot both believe
 * they won. Returns whether this call was the one that wrote.
 *
 * `updateMany` rather than `update` because `update` requires a unique
 * where-clause and would refuse the extra condition — and because the row
 * count is exactly the answer needed.
 */
export async function enrolTwoFactorSecret(
  tx: Tx,
  userId: string,
  secret: string,
  acceptedCounter: number,
): Promise<boolean> {
  const { count } = await auditedExecutor(tx).user.updateMany({
    where: { id: userId, twoFactorSecret: null },
    // The confirming code has been *used*: it must not sign the account in
    // as well, so it is recorded exactly as a sign-in would record it.
    data: { twoFactorSecret: secret, twoFactorLastCounter: acceptedCounter },
  });
  return count === 1;
}

/**
 * Withdraw a second factor — **the one the caller verified a code from**.
 *
 * Conditional on the stored secret still being that one, and answered by row
 * count. The claim in front of this (see `disableTotp`) is what turns away a
 * withdrawal queued behind another of the same factor; this condition is the
 * second line, so the function cannot remove a factor other than the one it
 * was told about, whoever calls it.
 *
 * The step record is deliberately **left in place** (H1). Blanking it here
 * re-opened the claim: a sign-in queued on the row with the same code was
 * re-checked after this committed, saw an empty record, and used the code a
 * second time. The next enrolment overwrites the record with its own accepted
 * step, so nothing needs it cleared.
 */
export async function clearTwoFactorSecret(
  tx: Tx,
  userId: string,
  expectedSecret: string,
): Promise<boolean> {
  const { count } = await auditedExecutor(tx).user.updateMany({
    where: { id: userId, twoFactorSecret: expectedSecret },
    data: { twoFactorSecret: null },
  });
  return count === 1;
}

/**
 * Record that a code from `counter` has been accepted — **only if it is later
 * than the last one, and the account still holds the secret the code was
 * checked against**. Returns whether it was.
 *
 * This is the replay guard, and it is a compare-and-set the database arbitrates
 * for the same reason enrolment is: two sign-ins carrying the same code at the
 * same instant must not both be told yes. A counter no greater than the one
 * already stored is the same code, or an older one, being used again.
 *
 * The secret is part of the predicate (H1) because the check and the claim are
 * two statements with a gap between them: a request that verified factor A can
 * reach its claim after A has been withdrawn and B enrolled. Its counter may
 * well be ahead of B's record; what it is not is a code for the factor the
 * account now holds. Binding the claim to A is what refuses it.
 */
export async function claimTotpCounter(
  userId: string,
  expectedSecret: string,
  counter: number,
  db?: DbExecutor,
): Promise<boolean> {
  const { count } = await executor(db).user.updateMany({
    where: {
      id: userId,
      twoFactorSecret: expectedSecret,
      OR: [{ twoFactorLastCounter: null }, { twoFactorLastCounter: { lt: counter } }],
    },
    data: { twoFactorLastCounter: counter },
  });
  return count === 1;
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
 * List users the principal may see *and manage*.
 *
 * Two filters, both here rather than in the caller: the store scope (a
 * store-bound list that forgets it is an IDOR) and the **role** scope. The role
 * filter is what stops a `STORE_MANAGER` seeing — and therefore being offered
 * reset/demote/disable buttons for — a peer manager in their own store.
 * `SUPER_ADMIN`s have no `storeId`, so a scoped principal never sees them either.
 */
export async function listVisibleUsers(
  principal: Principal,
  manageableRoles: readonly UserRole[],
  db?: DbExecutor,
): Promise<readonly UserRecord[]> {
  return executor(db).user.findMany({
    where: scopedWhere(
      principal,
      // A super-admin manages every role, so this is unrestricted for them.
      manageableRoles.length === 0 ? { id: '' } : { role: { in: [...manageableRoles] } },
    ),
    select: publicUserSelect,
    orderBy: [{ isActive: 'desc' }, { email: 'asc' }],
  });
}

/**
 * Read a user for mutation, holding its row lock until the transaction ends.
 *
 * The eligibility check has to run against the role the target has *now*, and
 * "now" has to mean "for the rest of this transaction" — otherwise a concurrent
 * promotion between the check and the write is a way past it. Raw SQL because
 * Prisma has no `FOR UPDATE`; the branded `Tx` is required for the same reason
 * it is everywhere else.
 */
export async function findByIdForUpdate(tx: Tx, id: string): Promise<UserRecord | null> {
  const rows = await auditedExecutor(tx).$queryRaw<
    {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      storeId: string | null;
      isActive: boolean;
      lastLoginAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    }[]
  >`
    SELECT "id", "email", "name", "role", "storeId", "isActive",
           "lastLoginAt", "createdAt", "updatedAt"
    FROM "User"
    WHERE "id" = ${id}
    FOR UPDATE
  `;
  return rows[0] ?? null;
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

export type { UserRole };

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
