/**
 * Use-cases for `identity`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 */
import argon2 from 'argon2';
import {
  assertAuthorized,
  AuthzError,
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
  type Tx,
  type Principal,
  type UserRole,
} from '../platform/index';
import {
  assertCanAssignRole,
  assertName,
  assertPasswordAcceptable,
  assertCanManageTarget,
  assertRoleStorePairing,
  descriptor,
  manageableRoles,
  SESSION_MAX_AGE_SECONDS,
  normalizeEmail,
  principalForUser,
  type ModuleDescriptor,
  type PrincipalSource,
} from './domain/index';
import * as repo from './repo';
import { generateTotpSecret, matchTotpCode, otpauthUri } from './domain/totp';

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
 * Check an email + password pair, ignoring any second factor.
 *
 * Module-private, and deliberately so: this is the *re-authentication* used by
 * the screens that make you retype your password (changing it, enrolling or
 * withdrawing a second factor). Those already hold a live session, so demanding
 * a TOTP code there would only ask the same authenticator twice — and in the
 * enrolment case, for a factor that is not switched on yet.
 *
 * Signing in goes through {@link verifyCredentials}, which adds the gate.
 *
 * Returns `null` for *every* failure — unknown email, wrong password, disabled
 * account — and always performs a verification, so a caller (and anyone timing
 * it) cannot tell which. That is what stops the sign-in form doubling as an
 * account-enumeration oracle.
 */
async function verifyPassword(email: string, password: string): Promise<AuthenticatedUser | null> {
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
 * Check a sign-in: email + password, and the authenticator code when the
 * account has one enrolled.
 *
 * Enrolment is optional (arch phase 2 — 2FA is offered, not required), but it
 * is not decorative: once a secret is stored, **the code is required to sign
 * in**. A second factor that the sign-in form did not ask for would protect
 * nothing at all.
 *
 * The gate keeps the same shape as the rest of this function — one
 * undifferentiated `null`. A missing or wrong code is not distinguishable from
 * a wrong password, so the form cannot be used to discover *who* has 2FA on.
 *
 * A code is good **once**. The step it came from is recorded on the account
 * and a code from that step, or an earlier one, is refused afterwards even
 * while the window would still accept it (RFC 6238 §5.2) — so a code seen in
 * flight cannot be replayed for the rest of its thirty seconds. The record is
 * a conditional write, so two sign-ins racing with the same code cannot both
 * win. A replay is refused with the same undifferentiated `null`.
 *
 * `lastLoginAt` is stamped here rather than in {@link verifyPassword}: it
 * records a sign-in, not every time someone retypes their password.
 */
export async function verifyCredentials(
  email: string,
  password: string,
  totpCode = '',
  now = Date.now(),
): Promise<AuthenticatedUser | null> {
  const user = await verifyPassword(email, password);
  if (user === null) return null;

  const secret = await repo.findTwoFactorSecret(user.id);
  if (secret !== null) {
    const counter = await matchTotpCode(secret, totpCode, now);
    if (counter === null) return null;
    if (!(await repo.claimTotpCounter(user.id, counter))) return null;
  }

  await repo.touchLastLogin(user.id);
  return user;
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

/**
 * Open a transaction, lock the target user, and run every eligibility check
 * against the row as it is *inside* that transaction — then hand it to `body`.
 *
 * The lock is the point. Checking the target's role before the transaction left
 * a window in which a concurrent promotion could change the answer between the
 * check and the write, so the check has to hold for the rest of the operation.
 * Three things are asserted here, in order:
 *
 * 1. the action itself is granted to the principal at all;
 * 2. the target's **store** is one the principal is scoped to;
 * 3. the target's **current role** is inside the principal's management scope —
 *    which is what stops a manager reaching a peer manager in their own store.
 */
async function withManagedTarget<T>(
  principal: Principal,
  userId: string,
  action: 'user:update' | 'user:disable' | 'user:reset-password',
  body: (tx: Tx, target: repo.UserRecord) => Promise<T>,
): Promise<T> {
  return withTransaction(async (tx) => {
    const target = await repo.findByIdForUpdate(tx, userId);
    if (target === null) throw new NotFoundError('User not found', { userId });

    assertAuthorized(principal, action, {
      type: 'User',
      id: userId,
      storeId: target.storeId,
    });
    assertCanManageTarget(principal, target);

    return body(tx, target);
  });
}

export async function listUsers(principal: Principal): Promise<readonly repo.UserRecord[]> {
  assertAuthorized(principal, 'user:read', { type: 'User', storeId: firstScopedStore(principal) });
  // Role-scoped as well as store-scoped: a manager runs their store's staff, so
  // a peer manager must not appear in a list that offers reset/disable actions.
  return repo.listVisibleUsers(principal, manageableRoles(principal));
}

export async function getUser(principal: Principal, userId: string): Promise<repo.UserRecord> {
  const user = await repo.findById(userId);
  if (user === null) throw new NotFoundError('User not found', { userId });
  assertAuthorized(principal, 'user:read', {
    type: 'User',
    id: user.id,
    storeId: user.storeId,
  });
  assertCanManageTarget(principal, user);
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
      storeId: user.storeId,
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
  return withManagedTarget(principal, userId, 'user:update', async (tx, before) => {
    const role = input.role ?? before.role;
    const proposedStoreId = input.storeId === undefined ? before.storeId : input.storeId;
    assertRoleStorePairing(role, proposedStoreId);

    // The *proposed* role and store are a separate question from whether this
    // target may be managed at all, and both are checked: a manager must not be
    // able to promote a staff member to peer, nor move them into another store.
    if (proposedStoreId !== before.storeId || role !== before.role) {
      assertCanAssignRole(principal, role);
      assertAuthorized(principal, 'user:update', {
        type: 'User',
        id: userId,
        storeId: proposedStoreId,
      });
    }

    const after = await repo.updateUser(tx, userId, {
      ...(input.name !== undefined ? { name: assertName(input.name) } : {}),
      role,
      storeId: proposedStoreId,
    });

    // A live cookie must not outlive the authority it was issued under.
    if (role !== before.role || proposedStoreId !== before.storeId) {
      await repo.deleteSessionsForUser(tx, userId);
    }

    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'User',
      entityId: userId,
      storeId: before.storeId,
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
  if (principal.kind === 'user' && principal.userId === userId && !isActive) {
    throw new ValidationError('You cannot disable your own account', { userId });
  }

  const after = await withManagedTarget(
    principal,
    userId,
    isActive ? 'user:update' : 'user:disable',
    async (tx, before) => {
      // Locking everyone out of the back office is not a recoverable state.
      if (!isActive && before.role === 'SUPER_ADMIN' && before.isActive) {
        if ((await repo.countActiveSuperAdmins(tx)) <= 1) {
          throw new ConflictError('The last active SUPER_ADMIN cannot be disabled', { userId });
        }
      }

      const updated = await repo.updateUser(tx, userId, { isActive });
      if (!isActive) await repo.deleteSessionsForUser(tx, userId);

      await writeAuditLog(tx, {
        principal,
        action: isActive ? 'enable' : 'disable',
        entityType: 'User',
        entityId: userId,
        storeId: before.storeId,
        before,
        after: updated,
      });
      return updated;
    },
  );

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
  const passwordHash = await hashPassword(newPassword);

  await withManagedTarget(principal, userId, 'user:reset-password', async (tx, before) => {
    await repo.updateUser(tx, userId, { passwordHash });
    await repo.deleteSessionsForUser(tx, userId);
    // The hash is never in the audit payload — only that a reset happened.
    await writeAuditLog(tx, {
      principal,
      action: 'reset-password',
      entityType: 'User',
      entityId: userId,
      storeId: before.storeId,
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

  const verified = await verifyPassword(user.email, currentPassword);
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
      storeId: user.storeId,
      before: { passwordChangedAt: user.updatedAt },
      after: { passwordChangedAt: new Date(), self: true },
    });
  });
}

// ---------------------------------------------------------------------------
// Optional two-factor authentication (TOTP)
// ---------------------------------------------------------------------------

export interface TotpEnrolment {
  /** Base32, shown once so it can be typed if the QR cannot be scanned. */
  readonly secret: string;
  /** The `otpauth://` URI an authenticator app scans. */
  readonly uri: string;
}

/**
 * Begin enrolling a second factor: mint a secret and hand it back.
 *
 * **Nothing is stored yet.** The secret is only written once the person has
 * proved their app is generating the right codes from it — see
 * {@link confirmTotpEnrolment}. Storing it here would switch 2FA on for someone
 * who then closed the tab, and lock them out of their own account.
 *
 * The secret therefore makes a round trip through the enrolment form. That is
 * the cost of not adding a column to hold a pending one, and it is bounded: it
 * travels over the same channel as the password that created the session.
 */
export async function beginTotpEnrolment(
  principal: Principal,
  issuer = 'Munder Fresh',
): Promise<TotpEnrolment> {
  if (principal.kind !== 'user') {
    throw new AuthzError('Only a signed-in staff member can enrol a second factor', {});
  }
  const user = await repo.findById(principal.userId);
  if (user === null) throw new NotFoundError('User not found', { userId: principal.userId });

  const secret = generateTotpSecret();
  // The email, not the id: an authenticator app lists the account label, and a
  // cuid tells its owner nothing about which login it belongs to.
  return { secret, uri: otpauthUri({ secret, account: user.email, issuer }) };
}

/**
 * Finish enrolling: store the secret, but only against a code it produced.
 *
 * Requires the current password as well. Enrolling a second factor changes how
 * the account is entered, so it is exactly the kind of change a borrowed,
 * still-signed-in browser should not be able to make.
 *
 * ## R1 — this is a strict `null` -> secret transition, and nothing else
 *
 * It used to write whatever secret it was handed, so an account that *already*
 * had a factor could have it replaced by someone holding only a live session
 * and the password: confirm a secret of your own, then `disableTotp` with a
 * code you can compute, and the original factor is gone without anyone ever
 * proving possession of it. The second factor existed precisely to stop the
 * person who has the password, so that path defeated the feature.
 *
 * Rotating a factor is therefore two deliberate steps — {@link disableTotp},
 * which demands a code from the *stored* secret, and then a fresh
 * {@link beginTotpEnrolment}. There is no in-place replace.
 *
 * The read below is for the error message; the guard that actually holds is
 * the conditional write in `repo.enrolTwoFactorSecret`, which lets the database
 * arbitrate two confirms racing on the same account. A check followed by an
 * unconditional write would let both believe they won.
 */
export async function confirmTotpEnrolment(
  principal: Principal,
  input: { secret: string; code: string; password: string },
  now = Date.now(),
): Promise<void> {
  if (principal.kind !== 'user') {
    throw new AuthzError('Only a signed-in staff member can enrol a second factor', {});
  }
  const user = await repo.findById(principal.userId);
  if (user === null) throw new NotFoundError('User not found', { userId: principal.userId });

  if ((await verifyPassword(user.email, input.password)) === null) {
    throw new ValidationError('That password is not correct', {});
  }
  const counter = await matchTotpCode(input.secret, input.code, now);
  if (counter === null) {
    throw new ValidationError(
      'That code does not match — check your authenticator and try the next one',
      {},
    );
  }
  if ((await repo.findTwoFactorSecret(principal.userId)) !== null) {
    throw new ConflictError('A second factor is already enrolled — disable it first', {});
  }

  await withTransaction(async (tx) => {
    if (!(await repo.enrolTwoFactorSecret(tx, principal.userId, input.secret, counter))) {
      // Somebody else enrolled between the read above and this write. Throwing
      // inside the transaction rolls the audit row back with it.
      throw new ConflictError('A second factor is already enrolled — disable it first', {});
    }
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'User',
      entityId: principal.userId,
      storeId: principal.storeId,
      before: { twoFactorEnrolled: false },
      after: { twoFactorEnrolled: true },
    });
  });
}

/**
 * Withdraw the second factor.
 *
 * Needs a current code as well as the password: if someone has the password
 * alone, the second factor is precisely what should stop them turning it off.
 * The secret itself is never logged — only that enrolment changed.
 */
export async function disableTotp(
  principal: Principal,
  input: { code: string; password: string },
  now = Date.now(),
): Promise<void> {
  if (principal.kind !== 'user') {
    throw new AuthzError('Only a signed-in staff member can change their second factor', {});
  }
  const user = await repo.findById(principal.userId);
  if (user === null) throw new NotFoundError('User not found', { userId: principal.userId });

  const secret = await repo.findTwoFactorSecret(principal.userId);
  if (secret === null) throw new ConflictError('You do not have a second factor enrolled', {});

  if ((await verifyPassword(user.email, input.password)) === null) {
    throw new ValidationError('That password is not correct', {});
  }
  const counter = await matchTotpCode(secret, input.code, now);
  if (counter === null) {
    throw new ValidationError('That code does not match', {});
  }

  await withTransaction(async (tx) => {
    // A replayed code cannot withdraw the factor either. The claim is inside
    // the transaction so a refusal rolls the audit row back with it.
    if (!(await repo.claimTotpCounter(principal.userId, counter, tx))) {
      throw new ValidationError('That code has already been used', {});
    }
    await repo.clearTwoFactorSecret(tx, principal.userId);
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'User',
      entityId: principal.userId,
      storeId: principal.storeId,
      before: { twoFactorEnrolled: true },
      after: { twoFactorEnrolled: false },
    });
  });
}

/** Has this user enrolled a second factor? For the account screen's copy. */
export async function hasTotpEnrolled(principal: Principal): Promise<boolean> {
  if (principal.kind !== 'user') return false;
  return (await repo.findTwoFactorSecret(principal.userId)) !== null;
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
