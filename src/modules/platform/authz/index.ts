import { AuthzError } from '../errors/index';

export type UserRole = 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STORE_STAFF';

/** Who is acting. A guest customer has no principal at all. */
export type Principal =
  | {
      readonly kind: 'user';
      readonly userId: string;
      readonly role: UserRole;
      readonly storeId: string | null;
    }
  | { readonly kind: 'customer'; readonly customerId: string }
  | { readonly kind: 'system' };

/** `<domain>:<verb>`, e.g. `order:transition`, `inventory:adjust`. */
export type Action = `${string}:${string}`;

/** What is being acted on. `storeId` is what store-scoping is decided from. */
export interface Resource {
  readonly type: string;
  readonly id?: string;
  readonly storeId?: string | null;
}

export interface AuthzDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

/**
 * The two principals that are allowed through while the rule table is empty.
 *
 * **Accepted deviation from "deny everything until there are rules" (§5).** Both
 * are deliberate, both are narrow, and both are load-bearing rather than
 * convenient:
 *
 * - `system` is the platform acting on its own behalf — seeds, migrations,
 *   scheduled jobs, event handlers. It is never derived from a request and has
 *   no session; a rule table cannot grant it anything because there is no
 *   subject to look up. Denying it would mean no background work can run at all.
 * - `SUPER_ADMIN` is the break-glass operator role. Every rule Phase 2 adds will
 *   grant it, so denying it now would only mean the pilot has no way in until
 *   the table is complete.
 *
 * Everything else — `STORE_MANAGER`, `STORE_STAFF`, customers and guests — is
 * denied, so no feature can be built on a permissive default. When the rule
 * table lands, `SUPER_ADMIN` becomes an ordinary (fully granted) row and only
 * the `system` exception should survive as a special case.
 *
 * `authz.test.ts` pins both exceptions, so removing them is a deliberate act.
 */
const PRIVILEGED_WITHOUT_RULES = ['system principal', 'SUPER_ADMIN'] as const;

export const AUTHZ_ACCEPTED_EXCEPTIONS: readonly string[] = PRIVILEGED_WITHOUT_RULES;

/**
 * Deny-by-default authorization (§5).
 *
 * Phase 1 stub: the real rule table lands with the modules that own the actions.
 * Only the two principals in {@link AUTHZ_ACCEPTED_EXCEPTIONS} are allowed
 * anything, so nothing can accidentally rely on a permissive default while the
 * table is empty.
 */
export function authorize(principal: Principal, action: Action, resource: Resource): AuthzDecision {
  if (principal.kind === 'system') {
    return { allowed: true, reason: PRIVILEGED_WITHOUT_RULES[0] };
  }

  if (principal.kind === 'user' && principal.role === 'SUPER_ADMIN') {
    return { allowed: true, reason: PRIVILEGED_WITHOUT_RULES[1] };
  }

  if (principal.kind === 'user' && resource.storeId != null) {
    const scoped = allowedStoreIds(principal).includes(resource.storeId);
    if (!scoped) {
      return { allowed: false, reason: `principal is not scoped to store ${resource.storeId}` };
    }
  }

  return { allowed: false, reason: `no rule grants ${action} on ${resource.type}` };
}

/** Throwing form for use-case code that should abort on denial. */
export function assertAuthorized(principal: Principal, action: Action, resource: Resource): void {
  const decision = authorize(principal, action, resource);
  if (!decision.allowed) {
    throw new AuthzError('You do not have permission to perform this action', {
      action,
      resourceType: resource.type,
      reason: decision.reason,
    });
  }
}

/**
 * The stores a principal may read/write. `SUPER_ADMIN` is unscoped — callers
 * must treat an empty array from a non-super-admin as "no access", never "all".
 */
export function allowedStoreIds(principal: Principal): readonly string[] {
  if (principal.kind !== 'user') return [];
  if (principal.role === 'SUPER_ADMIN') return [];
  return principal.storeId == null ? [] : [principal.storeId];
}

/** True when the principal may act across every store. */
export function isUnscoped(principal: Principal): boolean {
  return (
    principal.kind === 'system' || (principal.kind === 'user' && principal.role === 'SUPER_ADMIN')
  );
}
