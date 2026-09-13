import { AuthzError } from '../errors/index';

export type UserRole = 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STORE_STAFF';

/**
 * Who is acting.
 *
 * `customer` covers the whole storefront, signed in or not: `customerId` is
 * `null` for a guest — browsing and carting never require an account (arch §5,
 * R2) — and `storeId` is the store their delivery area resolved to. A visitor
 * who has not picked an area yet has neither, and can therefore read nothing
 * store-scoped, which is exactly right.
 *
 * A customer is deliberately **not** a weak `user`: the two draw their grants
 * from separate tables (see {@link CUSTOMER_GRANTS}) and their sessions from
 * separate stores, so no rule written for staff can ever apply to a shopper.
 */
export type Principal =
  | {
      readonly kind: 'user';
      readonly userId: string;
      readonly role: UserRole;
      readonly storeId: string | null;
    }
  | {
      readonly kind: 'customer';
      /** `null` for a guest — an account is optional, never a prerequisite. */
      readonly customerId: string | null;
      /** The store their chosen delivery area resolved to; `null` before they pick. */
      readonly storeId: string | null;
    }
  | { readonly kind: 'system' };

/**
 * Every action the platform knows about, `<domain>:<verb>`.
 *
 * A closed union rather than a template literal: an action that is not in this
 * list is a *typo*, and a typo that silently produced a deny would look exactly
 * like a policy decision. Adding a capability means adding it here and to the
 * role tables below, which is the whole point — the grant is visible in a diff.
 */
export type Action =
  // identity
  | 'user:read'
  | 'user:create'
  | 'user:update'
  | 'user:disable'
  | 'user:reset-password'
  // stores
  | 'store:read'
  | 'store:create'
  | 'store:update'
  | 'store-settings:read'
  | 'store-settings:update'
  | 'store-settings:update-pos-mode'
  | 'delivery-zone:read'
  | 'delivery-zone:write'
  | 'delivery-area:read'
  | 'delivery-area:write'
  | 'serviceability:resolve'
  // catalog (global master)
  | 'category:read'
  | 'category:write'
  | 'product:read'
  | 'product:write'
  | 'product-image:write'
  // pricing (per store)
  | 'store-product:read'
  | 'store-product:list'
  | 'store-product:set-price'
  | 'price-change:read'
  // inventory (per store)
  | 'inventory:read'
  | 'inventory:adjust'
  | 'inventory:reconcile'
  | 'inventory:import'
  | 'stock-ledger:read'
  // orders (per store) — added in Phase 4; no existing grant is touched
  | 'order:read'
  | 'order:transition'
  | 'order:cancel'
  | 'order:confirm-variance'
  // product requests (per store) — Phase 5.5; no existing grant is touched.
  // Submitting one is a shopper's act, gated in the module the way the
  // customers module gates its own writes, not a staff grant.
  | 'product-request:read'
  | 'product-request:manage'
  // audit
  | 'audit-log:read';

/**
 * What is being acted on. `storeId` is what store-scoping is decided from: a
 * store-scoped action with no `storeId` on the resource is refused, because
 * "unknown store" must never widen access.
 */
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
 * How a granted action is bounded.
 *
 * - `global` — the grant carries no store condition (catalogue master, creating
 *   stores). Only ever given to `SUPER_ADMIN`, plus the narrow `system` list.
 * - `store` — the resource's `storeId` must be one the principal is scoped to.
 */
type Grant = 'global' | 'store';

/**
 * `SUPER_ADMIN` — everything, unscoped. Spelled out rather than a wildcard so a
 * new `Action` is denied to *every* role until someone deliberately grants it;
 * a wildcard would silently hand each new capability to super-admins, which is
 * how a "deny by default" table quietly stops being one.
 */
const SUPER_ADMIN_GRANTS: Readonly<Record<Action, Grant>> = {
  'user:read': 'global',
  'user:create': 'global',
  'user:update': 'global',
  'user:disable': 'global',
  'user:reset-password': 'global',
  'store:read': 'global',
  'store:create': 'global',
  'store:update': 'global',
  'store-settings:read': 'global',
  'store-settings:update': 'global',
  'store-settings:update-pos-mode': 'global',
  'delivery-zone:read': 'global',
  'delivery-zone:write': 'global',
  'delivery-area:read': 'global',
  'delivery-area:write': 'global',
  'serviceability:resolve': 'global',
  'category:read': 'global',
  'category:write': 'global',
  'product:read': 'global',
  'product:write': 'global',
  'product-image:write': 'global',
  'store-product:read': 'global',
  'store-product:list': 'global',
  'store-product:set-price': 'global',
  'price-change:read': 'global',
  'inventory:read': 'global',
  'inventory:adjust': 'global',
  'inventory:reconcile': 'global',
  'inventory:import': 'global',
  'stock-ledger:read': 'global',
  'order:read': 'global',
  'order:transition': 'global',
  'order:cancel': 'global',
  'order:confirm-variance': 'global',
  // A request is a shopper's voice: nobody on staff submits one, whatever
  // their rank. Reading and triaging them is unscoped for a super-admin.
  'product-request:read': 'global',
  'product-request:manage': 'global',
  'audit-log:read': 'global',
};

/**
 * `STORE_MANAGER` — their own store, and nothing else.
 *
 * Deliberately absent: every catalogue-master write (`product:write`,
 * `category:write`, `product-image:write` — the master is global and shared, so
 * one store's manager editing it changes the other store's listings), store
 * create/update, and `store-settings:update-pos-mode` (which selects the POS
 * implementation and is a platform decision, ADR-0007).
 */
const STORE_MANAGER_GRANTS: Partial<Readonly<Record<Action, Grant>>> = {
  // Their own store's staff only — the store condition is what limits it.
  'user:read': 'store',
  'user:create': 'store',
  'user:update': 'store',
  'user:disable': 'store',
  'user:reset-password': 'store',
  'store:read': 'store',
  'store-settings:read': 'store',
  'store-settings:update': 'store',
  'delivery-zone:read': 'store',
  'delivery-zone:write': 'store',
  'delivery-area:read': 'store',
  'delivery-area:write': 'store',
  'serviceability:resolve': 'global',
  // Read the shared master, never write it.
  'category:read': 'global',
  'product:read': 'global',
  'store-product:read': 'store',
  'store-product:list': 'store',
  'store-product:set-price': 'store',
  'price-change:read': 'store',
  'inventory:read': 'store',
  'inventory:adjust': 'store',
  'inventory:reconcile': 'store',
  'inventory:import': 'store',
  'stock-ledger:read': 'store',
  // The audited correction and the variance confirmation are a manager's call,
  // not a staff member's: both change what a customer is asked to pay.
  'order:read': 'store',
  'order:transition': 'store',
  'order:cancel': 'store',
  'order:confirm-variance': 'store',
  // Triage — reviewing, planning, declining, marking fulfilled — is a
  // manager's call, in their own store.
  'product-request:read': 'store',
  'product-request:manage': 'store',
  'audit-log:read': 'store',
};

/**
 * `STORE_STAFF` — read-only in Phase 2. The picking, POS-billing and delivery
 * write paths that this role exists for arrive in Phase 4/5 and will add their
 * own grants here.
 */
const STORE_STAFF_GRANTS: Partial<Readonly<Record<Action, Grant>>> = {
  'store:read': 'store',
  'store-settings:read': 'store',
  'delivery-zone:read': 'store',
  'delivery-area:read': 'store',
  'serviceability:resolve': 'global',
  'category:read': 'global',
  'product:read': 'global',
  'store-product:read': 'store',
  'price-change:read': 'store',
  'inventory:read': 'store',
  'stock-ledger:read': 'store',
  // Staff see their store's queue and drive the fulfilment lifecycle — picking,
  // packing and dispatch are the work this role exists for (Phase 5). They
  // cannot cancel an order or confirm a revised amount: those stay with the
  // manager (`order:cancel`, `order:confirm-variance`), which is the D6 rule
  // expressed here rather than in the screen.
  'order:read': 'store',
  'order:transition': 'store',
  // Staff can see what shoppers are asking for; triage stays with the manager.
  'product-request:read': 'store',
};

/**
 * What a **storefront visitor** may do — a table entirely separate from the
 * staff roles above, and read-only.
 *
 * The storefront is public: there is no confidentiality boundary between one
 * store's listed catalogue and the other's, so the *global* grants here leak
 * nothing. `store`-scoped grants are the ones that matter — they bind price,
 * listing and stock reads to the store the visitor's delivery area resolved to,
 * through exactly the same `allowedStoreIds` machinery the back office uses.
 *
 * Deliberately absent: every write. A customer principal cannot adjust stock,
 * change a price, list a product or touch a `User` — not because the storefront
 * never calls those, but because a bug that did would be denied here. That is
 * what makes "Phase 3 writes no `websiteStock`" a property of the system rather
 * than of the code review.
 *
 * `product:read` and `category:read` are global because a slug is global (§8):
 * the store context decides listing, price and stock, and the storefront 404s a
 * product its store does not list. Reading the shared master row is not a leak.
 */
const CUSTOMER_GRANTS: Partial<Readonly<Record<Action, Grant>>> = {
  'serviceability:resolve': 'global',
  'category:read': 'global',
  'product:read': 'global',
  'store:read': 'store',
  'store-settings:read': 'store',
  'store-product:read': 'store',
  'inventory:read': 'store',
};

const ROLE_GRANTS: Readonly<Record<UserRole, Partial<Readonly<Record<Action, Grant>>>>> = {
  SUPER_ADMIN: SUPER_ADMIN_GRANTS,
  STORE_MANAGER: STORE_MANAGER_GRANTS,
  STORE_STAFF: STORE_STAFF_GRANTS,
};

/**
 * The internal principal, for code that runs with no session: boot, the seed,
 * and event handlers (ADR-0009).
 *
 * It is an explicit allowlist, **not** a wildcard. Phase 1 shipped `system` as
 * "allowed anything", which meant any code path that failed to build a real
 * principal could fall back to unlimited access. These are the actions internal
 * code actually performs — reads for the `stock.changed` handler's low-stock
 * threshold lookup, and the stock write the seed's opening balances need.
 */
const SYSTEM_GRANTS: Partial<Readonly<Record<Action, Grant>>> = {
  'store:read': 'global',
  'store-settings:read': 'global',
  'product:read': 'global',
  'store-product:read': 'global',
  'inventory:read': 'global',
  'inventory:adjust': 'global',
  'stock-ledger:read': 'global',
};

/**
 * Which stores a principal may touch. **`null` means every store** — only
 * `SUPER_ADMIN` and `system` get it.
 *
 * The Phase 1 version returned `[]` for a super-admin *and* for a user with no
 * store, so "unrestricted" and "no access at all" were the same value and the
 * caller had to remember which was which. `null` makes the compiler ask.
 */
export function allowedStoreIds(principal: Principal): readonly string[] | null {
  if (principal.kind === 'system') return null;
  // A shopper is scoped to the one store their delivery area resolved to, and
  // to none at all before they have picked one.
  if (principal.kind === 'customer') {
    return principal.storeId == null ? [] : [principal.storeId];
  }
  if (principal.role === 'SUPER_ADMIN') return null;
  return principal.storeId == null ? [] : [principal.storeId];
}

/** True when the principal may act across every store. */
export function isUnscoped(principal: Principal): boolean {
  return allowedStoreIds(principal) === null;
}

/**
 * A Prisma `where` fragment that limits a query to the principal's stores.
 *
 * Every store-bound list goes through this rather than hand-written filters:
 * a forgotten filter is an IDOR, and `{}` for an unscoped principal is the only
 * case where "no condition" is correct.
 */
export function storeScopeFilter(
  principal: Principal,
  field = 'storeId',
): Record<string, { in: readonly string[] }> | Record<string, never> {
  const ids = allowedStoreIds(principal);
  return ids === null ? {} : { [field]: { in: ids } };
}

/** True when this principal may act on data belonging to `storeId`. */
export function canAccessStore(principal: Principal, storeId: string): boolean {
  const ids = allowedStoreIds(principal);
  return ids === null || ids.includes(storeId);
}

function grantsFor(principal: Principal): Partial<Readonly<Record<Action, Grant>>> | null {
  if (principal.kind === 'system') return SYSTEM_GRANTS;
  // Shoppers draw from their own read-only table, never from a staff role.
  if (principal.kind === 'customer') return CUSTOMER_GRANTS;

  // A store-bound role with no store is a data defect (the identity service
  // refuses to create one). Until it is fixed the safe reading is *no* access,
  // not "everything that happens to be unscoped" — otherwise a broken row would
  // still read the shared catalogue.
  if (principal.role !== 'SUPER_ADMIN' && principal.storeId == null) return null;

  return ROLE_GRANTS[principal.role];
}

/**
 * Deny-by-default authorization (§5).
 *
 * Three questions, in order, and any "no" denies: is there a grant for this
 * principal and action at all; if the grant is store-scoped, does the resource
 * name a store; and is that store one the principal is scoped to.
 */
export function authorize(principal: Principal, action: Action, resource: Resource): AuthzDecision {
  const grants = grantsFor(principal);
  if (grants === null) {
    return {
      allowed: false,
      reason: `${describe(principal)} principals have no back-office access`,
    };
  }

  const grant = grants[action];
  if (grant === undefined) {
    return { allowed: false, reason: `no rule grants ${action} on ${resource.type}` };
  }

  if (grant === 'global') {
    return { allowed: true, reason: `${describe(principal)} is granted ${action}` };
  }

  // Store-scoped from here: an unknown store must narrow access, never widen it.
  if (resource.storeId == null) {
    return {
      allowed: false,
      reason: `${action} is store-scoped but ${resource.type} names no store`,
    };
  }

  if (!canAccessStore(principal, resource.storeId)) {
    return { allowed: false, reason: `principal is not scoped to store ${resource.storeId}` };
  }

  return { allowed: true, reason: `${describe(principal)} is granted ${action} in its own store` };
}

function describe(principal: Principal): string {
  return principal.kind === 'user' ? principal.role : principal.kind;
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
 * Every action in the union, for exhaustive tests. `SUPER_ADMIN_GRANTS` is a
 * total `Record<Action, Grant>`, so its keys *are* the action list and cannot
 * drift from it.
 */
export const ALL_ACTIONS: readonly Action[] = Object.keys(SUPER_ADMIN_GRANTS) as Action[];
