/**
 * Pure domain logic for `identity` — no I/O, no Prisma, no framework types.
 */
import { AuthzError, ValidationError, type Principal, type UserRole } from '../../platform/index';

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'identity',
  owns: 'User, RBAC, staff authentication',
  dependsOn: ['platform'],
  emits: ['user.created', 'user.disabled'],
};

export const USER_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'STORE_MANAGER', 'STORE_STAFF'];

/**
 * Absolute session lifetime. A staff session dies after this whatever the user
 * is doing — it is not extended by activity, so a walked-away-from terminal in
 * the back room stops being a way in the following morning.
 *
 * A security policy, not infrastructure and not a per-store business setting, so
 * it is a constant here rather than env (§22) or `StoreSettings`.
 */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/**
 * `SUPER_ADMIN` is the only role that is *not* scoped to a store, and it must
 * not be: a super-admin with a `storeId` would read as store-scoped to anything
 * that trusted the column, and `authz` treats a store-bound role with no store
 * as having no access at all. Both directions are enforced, on every write.
 */
export function assertRoleStorePairing(role: UserRole, storeId: string | null): void {
  if (role === 'SUPER_ADMIN' && storeId !== null) {
    throw new ValidationError('A SUPER_ADMIN is not scoped to a store', { role, storeId });
  }
  if (role !== 'SUPER_ADMIN' && storeId === null) {
    throw new ValidationError(`A ${role} must be assigned to a store`, { role });
  }
}

/** The minimum a password must clear. Length is the part that actually matters. */
export const MIN_PASSWORD_LENGTH = 12;

export function assertPasswordAcceptable(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, {
      length: password.length,
    });
  }
  if (password.trim().length === 0) {
    throw new ValidationError('Password must not be only whitespace', {});
  }
}

/**
 * Emails are compared lower-cased and trimmed so `A@b.com` and `a@b.com` cannot
 * become two accounts racing for one identity.
 */
export function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  // Deliberately permissive: one `@`, something either side, no whitespace.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ValidationError('Enter a valid email address', { email });
  }
  return normalized;
}

export function assertName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new ValidationError('Name is required', {});
  return trimmed;
}

/** The fields of a `User` row that authorization decisions are made from. */
export interface PrincipalSource {
  readonly id: string;
  readonly role: UserRole;
  readonly storeId: string | null;
  readonly isActive: boolean;
}

/**
 * Build the authorization principal for a signed-in user.
 *
 * A disabled user has **no** principal — not a principal with fewer grants.
 * Anything holding a live session for a user who was just disabled therefore
 * fails the next authorization check rather than continuing on a stale role.
 */
export function principalForUser(user: PrincipalSource): Principal | null {
  if (!user.isActive) return null;
  return { kind: 'user', userId: user.id, role: user.role, storeId: user.storeId };
}

/**
 * Which roles a principal may create or assign.
 *
 * A `STORE_MANAGER` runs their own store's staff and nothing more — they cannot
 * mint another manager or a super-admin, which is the privilege-escalation path
 * that store-scoped user management otherwise opens.
 */
export function assignableRoles(principal: Principal): readonly UserRole[] {
  if (principal.kind !== 'user') return [];
  if (principal.role === 'SUPER_ADMIN') return USER_ROLES;
  if (principal.role === 'STORE_MANAGER') return ['STORE_STAFF'];
  return [];
}

export function assertCanAssignRole(principal: Principal, role: UserRole): void {
  if (!assignableRoles(principal).includes(role)) {
    throw new ValidationError('You may not assign that role', { role });
  }
}

/**
 * Which roles a principal may *manage an existing user of*.
 *
 * Deliberately separate from {@link assignableRoles}, which answers a different
 * question: what role the target may be given. Checking only the proposed role
 * left a hole — a `STORE_MANAGER` could reset, demote or disable a **peer
 * manager** in their own store, because the store matched and the proposed role
 * (`STORE_STAFF`) was one they were allowed to assign. Two managers could
 * therefore evict or take over one another.
 *
 * A manager runs their store's *staff*. Anyone else in the store — another
 * manager — is above them, and a `SUPER_ADMIN` is not in a store at all.
 */
export function manageableRoles(principal: Principal): readonly UserRole[] {
  if (principal.kind !== 'user') return [];
  if (principal.role === 'SUPER_ADMIN') return USER_ROLES;
  if (principal.role === 'STORE_MANAGER') return ['STORE_STAFF'];
  return [];
}

/**
 * Refuse to act on a target whose **current** role is out of the principal's
 * management scope. Checked on reads and on every mutation, against the role the
 * target has *now* — not the one the caller proposes.
 */
export function assertCanManageTarget(
  principal: Principal,
  target: { readonly id: string; readonly role: UserRole },
): void {
  // Managing your own account (changing your own password) is always allowed;
  // the caller is not escalating anything by acting on themselves.
  if (principal.kind === 'user' && principal.userId === target.id) return;

  if (!manageableRoles(principal).includes(target.role)) {
    throw new AuthzError('You do not have permission to manage that user', {
      targetRole: target.role,
      reason: 'target is outside your management scope',
    });
  }
}
