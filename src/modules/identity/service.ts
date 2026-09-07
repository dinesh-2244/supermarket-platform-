/**
 * Use-cases for `identity`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 */
import argon2 from 'argon2';
import {
  assertAuthorized,
  canAccessStore,
  ConflictError,
  emit,
  newId,
  NotFoundError,
  sessionToken,
  Prisma,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type Principal,
  type UserRole,
} from '../platform/index';
import {
  assertCanAssignRole,
  assertName,
  assertPasswordAcceptable,
  assertRoleStorePairing,
  descriptor,
  SESSION_MAX_AGE_SECONDS,
  normalizeEmail,
  principalForUser,
  type ModuleDescriptor,
  type PrincipalSource,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type { UserRecord } from './repo';

/**
 * argon2**id** with deliberately non-default cost (arch §20). The defaults are
 * tuned for a laptop; these are the OWASP-recommended floor for an interactive
 * login and still complete in well under a second on the pilot's hardware.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(password: string): Promise<string> {
  assertPasswordAcceptable(password);
  return argon2.hash(password, ARGON2_OPTIONS);
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export interface AuthenticatedUser extends PrincipalSource {
  readonly email: string;
  readonly name: string;
}

/**
 * Check an email + password pair.
 *
 * Returns `null` for *every* failure — unknown email, wrong password, disabled
 * account — and always performs a verification, so a caller (and anyone timing
 * it) cannot tell which. That is what stops the sign-in form doubling as an
 * account-enumeration oracle.
 */
export async function verifyCredentials(
  email: string,
  password: string,
): Promise<AuthenticatedUser | null> {
  let normalized: string;
  try {
    normalized = normalizeEmail(email);
  } catch {
    normalized = '';
  }

  const user = normalized === '' ? null : await repo.findByEmailWithSecret(normalized);

  // A real hash of the *same* parameters, so the no-such-user path costs what
  // the real one does instead of returning instantly.
  const hash = user?.passwordHash ?? (await dummyHash());
  let ok = false;
  try {
    ok = await argon2.verify(hash, password);
  } catch {
    ok = false;
  }

  if (!user || !ok || !user.isActive) return null;

  await repo.touchLastLogin(user.id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    storeId: user.storeId,
    isActive: user.isActive,
  };
}

/**
 * A genuine argon2id hash of a value nobody can supply, computed once on first
 * use. It has to be a *real* hash: a hand-written constant makes `argon2.verify`
 * reject the input as malformed almost instantly, which restores exactly the
 * timing difference this exists to remove.
 */
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= argon2.hash(`no-such-user-${newId()}`, ARGON2_OPTIONS);
  return dummyHashPromise;
}

/** The authorization principal for a signed-in user id, or `null` if it has none. */
export async function principalForUserId(userId: string): Promise<Principal | null> {
  const user = await repo.findById(userId);
  return user === null ? null : principalForUser(user);
}

// ---------------------------------------------------------------------------
// User management
// ---------------------------------------------------------------------------

export async function listUsers(principal: Principal): Promise<readonly repo.UserRecord[]> {
  assertAuthorized(principal, 'user:read', { type: 'User', storeId: firstScopedStore(principal) });
  return repo.listVisibleUsers(principal);
}

export async function getUser(principal: Principal, userId: string): Promise<repo.UserRecord> {
  const user = await repo.findById(userId);
  if (user === null) throw new NotFoundError('User not found', { userId });
  assertAuthorized(principal, 'user:read', {
    type: 'User',
    id: user.id,
    storeId: user.storeId,
  });
  return user;
}

export interface CreateUserInput {
  readonly email: string;
  readonly name: string;
  readonly password: string;
  readonly role: UserRole;
  readonly storeId: string | null;
}

/**
 * Create a staff user. There is no public signup — this is the only way a `User`
 * row comes into existence outside the seed.
 */
export async function createUser(
  principal: Principal,
  input: CreateUserInput,
): Promise<repo.UserRecord> {
  const email = normalizeEmail(input.email);
  const name = assertName(input.name);
  assertRoleStorePairing(input.role, input.storeId);
  // Authorization first: a principal with no user-management grant at all must
  // be told *that*, not handed a narrower complaint about the role it picked.
  assertAuthorized(principal, 'user:create', { type: 'User', storeId: input.storeId });
  assertCanAssignRole(principal, input.role);

  const passwordHash = await hashPassword(input.password);

  const created = await withTransaction(async (tx) => {
    const user = await repo
      .insertUser(tx, { email, name, passwordHash, role: input.role, storeId: input.storeId })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictError('A user with that email already exists', { email });
        }
        throw error;
      });

    await writeAuditLog(tx, {
      principal,
      action: 'create',
      entityType: 'User',
      entityId: user.id,
      after: user,
    });
    return user;
  });

  emit('user.created', { userId: created.id });
  return created;
}

export interface UpdateUserInput {
  readonly name?: string;
  readonly role?: UserRole;
  readonly storeId?: string | null;
}

/**
 * Change a user's name, role or store.
 *
 * Both the *current* and the *proposed* store are authorized: a manager must not
 * be able to move one of their staff into another store (which would be a write
 * to a store they have no grant on), nor pull another store's user into theirs.
 */
export async function updateUser(
  principal: Principal,
  userId: string,
  input: UpdateUserInput,
): Promise<repo.UserRecord> {
  const before = await repo.findById(userId);
  if (before === null) throw new NotFoundError('User not found', { userId });

  const role = input.role ?? before.role;
  const storeId = input.storeId === undefined ? before.storeId : input.storeId;
  assertRoleStorePairing(role, storeId);

  assertAuthorized(principal, 'user:update', {
    type: 'User',
    id: userId,
    storeId: before.storeId,
  });
  if (storeId !== before.storeId || role !== before.role) {
    assertCanAssignRole(principal, role);
    assertAuthorized(principal, 'user:update', { type: 'User', id: userId, storeId });
  }

  const authorityChanged = role !== before.role || storeId !== before.storeId;

  return withTransaction(async (tx) => {
    const after = await repo.updateUser(tx, userId, {
      ...(input.name !== undefined ? { name: assertName(input.name) } : {}),
      role,
      storeId,
    });

    // A live cookie must not outlive the authority it was issued under.
    if (authorityChanged) await repo.deleteSessionsForUser(tx, userId);

    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'User',
      entityId: userId,
      before,
      after,
    });
    return after;
  });
}

/**
 * Disable or re-enable a user.
 *
 * Disabling drops their sessions in the same transaction, so "disabled" takes
 * effect on the next request rather than whenever their cookie happens to
 * expire. The last active `SUPER_ADMIN` cannot be disabled — locking everyone
 * out of the back office is not a recoverable state.
 */
export async function setUserActive(
  principal: Principal,
  userId: string,
  isActive: boolean,
): Promise<repo.UserRecord> {
  const before = await repo.findById(userId);
  if (before === null) throw new NotFoundError('User not found', { userId });

  assertAuthorized(principal, isActive ? 'user:update' : 'user:disable', {
    type: 'User',
    id: userId,
    storeId: before.storeId,
  });

  if (!isActive && principal.kind === 'user' && principal.userId === userId) {
    throw new ValidationError('You cannot disable your own account', { userId });
  }
  if (!isActive && before.role === 'SUPER_ADMIN' && before.isActive) {
    if ((await repo.countActiveSuperAdmins()) <= 1) {
      throw new ConflictError('The last active SUPER_ADMIN cannot be disabled', { userId });
    }
  }

  const after = await withTransaction(async (tx) => {
    const updated = await repo.updateUser(tx, userId, { isActive });
    if (!isActive) await repo.deleteSessionsForUser(tx, userId);

    await writeAuditLog(tx, {
      principal,
      action: isActive ? 'enable' : 'disable',
      entityType: 'User',
      entityId: userId,
      before,
      after: updated,
    });
    return updated;
  });

  if (!isActive) emit('user.disabled', { userId });
  return after;
}

/**
 * Set someone else's password (an admin reset). Their sessions are dropped, so a
 * reset actually evicts whoever might be holding the account.
 */
export async function resetPassword(
  principal: Principal,
  userId: string,
  newPassword: string,
): Promise<void> {
  const before = await repo.findById(userId);
  if (before === null) throw new NotFoundError('User not found', { userId });

  assertAuthorized(principal, 'user:reset-password', {
    type: 'User',
    id: userId,
    storeId: before.storeId,
  });

  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (tx) => {
    await repo.updateUser(tx, userId, { passwordHash });
    await repo.deleteSessionsForUser(tx, userId);
    // The hash is never in the audit payload — only that a reset happened.
    await writeAuditLog(tx, {
      principal,
      action: 'reset-password',
      entityType: 'User',
      entityId: userId,
      before: { passwordChangedAt: before.updatedAt },
      after: { passwordChangedAt: new Date() },
    });
  });
}

/**
 * Change your own password. Requires the current one, so a borrowed session
 * cannot lock the real owner out.
 */
export async function changeOwnPassword(
  principal: Principal,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  if (principal.kind !== 'user') {
    throw new ValidationError('Only a signed-in user can change their password', {});
  }
  const user = await repo.findById(principal.userId);
  if (user === null) throw new NotFoundError('User not found', { userId: principal.userId });

  const verified = await verifyCredentials(user.email, currentPassword);
  if (verified === null) {
    throw new ValidationError('Your current password is not correct', {});
  }

  const passwordHash = await hashPassword(newPassword);

  await withTransaction(async (tx) => {
    await repo.updateUser(tx, user.id, { passwordHash });
    await writeAuditLog(tx, {
      principal,
      action: 'reset-password',
      entityType: 'User',
      entityId: user.id,
      before: { passwordChangedAt: user.updatedAt },
      after: { passwordChangedAt: new Date(), self: true },
    });
  });
}

/**
 * The store a scoped principal acts in, for authorizing list-shaped actions that
 * have no single resource. `null` for an unscoped principal.
 */
function firstScopedStore(principal: Principal): string | null {
  if (principal.kind !== 'user') return null;
  return principal.storeId;
}

/** True when this principal may manage users belonging to `storeId`. */
export function canManageStoreUsers(principal: Principal, storeId: string): boolean {
  return canAccessStore(principal, storeId);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface ActiveSession {
  readonly token: string;
  readonly expires: Date;
  readonly user: repo.UserRecord;
  readonly principal: Principal;
}

/**
 * Mint a session row for a user who has just proved their password.
 *
 * The token is 256 bits from the CSPRNG and is the *only* thing the cookie
 * carries — no role, no store, nothing a client could edit. Every sign-in mints
 * a new one, which is what "rotation on login" means here: the previous token is
 * not re-blessed, it simply stays whatever it was until it expires or is deleted.
 */
export async function createSessionForUser(
  userId: string,
): Promise<{ token: string; expires: Date }> {
  const token = sessionToken();
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await repo.insertSession(token, userId, expires);
  return { token, expires };
}

/**
 * Resolve a session token to a live principal, or `null`.
 *
 * Re-read on **every** request rather than trusted from the cookie, so a role
 * change, a store move or a disable takes effect on the next request instead of
 * whenever the token happens to expire. An expired row is deleted as it is found.
 */
export async function readSession(token: string): Promise<ActiveSession | null> {
  const found = await repo.findSessionWithUser(token);
  if (found === null) return null;

  if (found.session.expires.getTime() <= Date.now()) {
    await repo.deleteSession(token);
    return null;
  }

  const principal = principalForUser(found.user);
  if (principal === null) {
    // The user was disabled while holding a live cookie.
    await repo.deleteSession(token);
    return null;
  }

  return { token, expires: found.session.expires, user: found.user, principal };
}

/** Sign out: the row goes, so the cookie is worthless immediately. */
export async function destroySession(token: string): Promise<void> {
  await repo.deleteSession(token);
}

/** Housekeeping for expired rows. Safe to call from anywhere; never throws on empty. */
export async function purgeExpiredSessions(now: Date = new Date()): Promise<number> {
  return repo.deleteExpiredSessions(now);
}
