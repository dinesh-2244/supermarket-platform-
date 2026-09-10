import { describe, expect, it } from 'vitest';
import {
  type Action,
  ALL_ACTIONS,
  type Resource,
  allowedStoreIds,
  assertAuthorized,
  authorize,
  canAccessStore,
  isUnscoped,
  type Principal,
  storeScopeFilter,
} from '../authz/index';
import { AuthzError } from '../errors/index';

const STORE_A = 'store-a';
const STORE_B = 'store-b';

const superAdmin = { kind: 'user', userId: 'u1', role: 'SUPER_ADMIN', storeId: null } as const;
const managerA = { kind: 'user', userId: 'u2', role: 'STORE_MANAGER', storeId: STORE_A } as const;
const managerB = { kind: 'user', userId: 'u3', role: 'STORE_MANAGER', storeId: STORE_B } as const;
const staffA = { kind: 'user', userId: 'u4', role: 'STORE_STAFF', storeId: STORE_A } as const;
/** A visitor who has not picked a delivery area yet: no account, no store. */
const visitor = { kind: 'customer', customerId: null, storeId: null } as const;
/** A guest whose area resolved to store A. Still no account. */
const shopperA = { kind: 'customer', customerId: null, storeId: STORE_A } as const;
/** The same shopper once they have created an account. */
const accountA = { kind: 'customer', customerId: 'c1', storeId: STORE_A } as const;
const system = { kind: 'system' } as const;
/** A manager row with no store — a data defect. It must read as *no* access. */
const unassignedManager = {
  kind: 'user',
  userId: 'u5',
  role: 'STORE_MANAGER',
  storeId: null,
} as const;

const inA = (type: string) => ({ type, storeId: STORE_A });
const inB = (type: string) => ({ type, storeId: STORE_B });

function allows(principal: Principal, action: Action, resource: Resource = inA('Thing')): boolean {
  return authorize(principal, action, resource).allowed;
}

/**
 * Exactly what a storefront visitor may do. Everything else is denied, and the
 * sweep below is what keeps this list honest as `Action` grows: a capability
 * added for the back office is never silently handed to shoppers.
 */
const CUSTOMER_READS: readonly Action[] = [
  'serviceability:resolve',
  'category:read',
  'product:read',
  'store:read',
  'store-settings:read',
  'store-product:read',
  'inventory:read',
];

describe('platform/authz — deny by default', () => {
  it('grants a shopper their own store’s reads and nothing else', () => {
    for (const action of ALL_ACTIONS) {
      expect(allows(shopperA, action)).toBe(CUSTOMER_READS.includes(action));
    }
  });

  // An account changes who you are, never what you may do.
  it('gives a signed-in customer no more than a guest', () => {
    for (const action of ALL_ACTIONS) {
      expect(allows(accountA, action)).toBe(allows(shopperA, action));
    }
  });

  it('denies a shopper every write, however the resource is dressed up', () => {
    const writes = ALL_ACTIONS.filter((action) => !CUSTOMER_READS.includes(action));
    expect(writes.length).toBeGreaterThan(20);
    for (const action of writes) {
      expect(allows(shopperA, action)).toBe(false);
      expect(allows(shopperA, action, { type: 'Thing', storeId: null })).toBe(false);
      expect(allows(accountA, action, inB('Thing'))).toBe(false);
    }
  });

  it('denies a visitor with no delivery area every store-scoped read', () => {
    for (const action of ALL_ACTIONS) {
      const globalRead =
        action === 'serviceability:resolve' ||
        action === 'category:read' ||
        action === 'product:read';
      expect(allows(visitor, action)).toBe(globalRead);
    }
  });

  it('confines a shopper to the store their area resolved to', () => {
    expect(allows(shopperA, 'store-product:read', inA('StoreProduct'))).toBe(true);
    expect(allows(shopperA, 'store-product:read', inB('StoreProduct'))).toBe(false);
    expect(allows(shopperA, 'inventory:read', inB('InventoryItem'))).toBe(false);
    // A store-scoped read whose resource names no store is refused, not widened.
    expect(allows(shopperA, 'inventory:read', { type: 'InventoryItem', storeId: null })).toBe(
      false,
    );
  });

  // The two tables are unrelated: neither principal borrows the other's rules.
  it('keeps the customer table separate from the staff tables', () => {
    expect(allows(shopperA, 'inventory:adjust', inA('InventoryItem'))).toBe(false);
    expect(allows(staffA, 'inventory:adjust', inA('InventoryItem'))).toBe(false);
    expect(allows(managerA, 'inventory:adjust', inA('InventoryItem'))).toBe(true);
    // …and a staff principal is not treated as a shopper either.
    expect(allows(managerB, 'store-product:read', inA('StoreProduct'))).toBe(false);
  });

  it('denies a manager whose row carries no store, on every store-scoped action', () => {
    for (const action of ALL_ACTIONS) {
      expect(allows(unassignedManager, action, { type: 'Thing', storeId: STORE_A })).toBe(false);
    }
  });

  it('refuses a store-scoped action when the resource names no store', () => {
    const decision = authorize(managerA, 'inventory:adjust', { type: 'InventoryItem' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/names no store/);
  });

  it('refuses an action that is in no role table at all', () => {
    // Cast: the point is to prove an unknown verb is denied, not to add one.
    const decision = authorize(superAdmin, 'nonsense:verb' as Action, { type: 'Thing' });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/no rule grants/);
  });
});

describe('platform/authz — SUPER_ADMIN', () => {
  it('is granted every action, in any store', () => {
    for (const action of ALL_ACTIONS) {
      expect(allows(superAdmin, action, inA('Thing'))).toBe(true);
      expect(allows(superAdmin, action, inB('Thing'))).toBe(true);
      expect(allows(superAdmin, action, { type: 'Thing' })).toBe(true);
    }
  });
});

describe('platform/authz — STORE_MANAGER', () => {
  const ownStoreWrites: readonly Action[] = [
    'store-settings:update',
    'delivery-zone:write',
    'delivery-area:write',
    'store-product:list',
    'store-product:set-price',
    'inventory:adjust',
    'inventory:reconcile',
    'inventory:import',
    'user:create',
    'user:disable',
  ];

  it('may act on its own store', () => {
    for (const action of ownStoreWrites) {
      expect(allows(managerA, action, inA('Thing'))).toBe(true);
    }
  });

  // The tenancy boundary: same action, other store, every time.
  it('is refused the identical action on another store', () => {
    for (const action of ownStoreWrites) {
      const decision = authorize(managerA, action, inB('Thing'));
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain(STORE_B);
    }
  });

  it('is refused every catalogue-master write — the master is shared', () => {
    for (const action of ['product:write', 'category:write', 'product-image:write'] as const) {
      expect(allows(managerA, action, inA('Product'))).toBe(false);
      expect(allows(managerA, action, { type: 'Product' })).toBe(false);
    }
  });

  it('may read the shared master', () => {
    expect(allows(managerA, 'product:read', { type: 'Product' })).toBe(true);
    expect(allows(managerA, 'category:read', { type: 'Category' })).toBe(true);
  });

  it('is refused SUPER_ADMIN-only store actions', () => {
    expect(allows(managerA, 'store:create', inA('Store'))).toBe(false);
    expect(allows(managerA, 'store:update', inA('Store'))).toBe(false);
    // posMode selects the POS implementation — a platform decision (ADR-0007).
    expect(allows(managerA, 'store-settings:update-pos-mode', inA('StoreSettings'))).toBe(false);
  });

  it('two managers cannot reach each other', () => {
    expect(allows(managerA, 'inventory:adjust', inB('InventoryItem'))).toBe(false);
    expect(allows(managerB, 'inventory:adjust', inA('InventoryItem'))).toBe(false);
    expect(allows(managerB, 'inventory:adjust', inB('InventoryItem'))).toBe(true);
  });
});

describe('platform/authz — STORE_STAFF', () => {
  it('is read-only in its own store', () => {
    expect(allows(staffA, 'inventory:read', inA('InventoryItem'))).toBe(true);
    expect(allows(staffA, 'stock-ledger:read', inA('StockLedger'))).toBe(true);
    expect(allows(staffA, 'store-product:read', inA('StoreProduct'))).toBe(true);
  });

  it('is refused every write, including in its own store', () => {
    for (const action of [
      'inventory:adjust',
      'inventory:reconcile',
      'inventory:import',
      'store-product:set-price',
      'store-settings:update',
      'delivery-zone:write',
      'user:create',
      'product:write',
    ] as const) {
      expect(allows(staffA, action, inA('Thing'))).toBe(false);
    }
  });

  it('cannot read another store', () => {
    expect(allows(staffA, 'inventory:read', inB('InventoryItem'))).toBe(false);
  });
});

describe('platform/authz — the system principal', () => {
  // Phase 1 gave `system` a wildcard, which meant any code path that failed to
  // build a real principal fell back to unlimited access. It is an allowlist now.
  it('is granted only the narrow internal set', () => {
    expect(allows(system, 'inventory:adjust', inA('InventoryItem'))).toBe(true);
    expect(allows(system, 'store-settings:read', inA('StoreSettings'))).toBe(true);
    expect(allows(system, 'inventory:read', inB('InventoryItem'))).toBe(true);
  });

  it('is NOT a wildcard — its grants are exactly this narrow set', () => {
    const granted = ALL_ACTIONS.filter((action) => allows(system, action, inA('Thing')));

    expect([...granted].sort()).toEqual(
      [
        'inventory:adjust',
        'inventory:read',
        'product:read',
        'store-product:read',
        'store-settings:read',
        'stock-ledger:read',
        'store:read',
      ].sort(),
    );

    // Everything else in the union is refused — including every user, pricing,
    // catalogue-write and import action.
    for (const action of ALL_ACTIONS.filter((a) => !granted.includes(a))) {
      expect(allows(system, action, inA('Thing'))).toBe(false);
    }
    expect(granted.length).toBeLessThan(ALL_ACTIONS.length);
  });
});

describe('platform/authz — store scoping helpers', () => {
  it('distinguishes "every store" from "no store"', () => {
    expect(allowedStoreIds(superAdmin)).toBeNull();
    expect(allowedStoreIds(system)).toBeNull();
    expect(allowedStoreIds(managerA)).toEqual([STORE_A]);
    expect(allowedStoreIds(unassignedManager)).toEqual([]);
    expect(allowedStoreIds(visitor)).toEqual([]);
    expect(allowedStoreIds(shopperA)).toEqual([STORE_A]);
  });

  it('isUnscoped agrees with allowedStoreIds', () => {
    expect(isUnscoped(superAdmin)).toBe(true);
    expect(isUnscoped(system)).toBe(true);
    expect(isUnscoped(managerA)).toBe(false);
    expect(isUnscoped(visitor)).toBe(false);
    expect(isUnscoped(shopperA)).toBe(false);
  });

  it('canAccessStore is per-store, not per-role', () => {
    expect(canAccessStore(managerA, STORE_A)).toBe(true);
    expect(canAccessStore(managerA, STORE_B)).toBe(false);
    expect(canAccessStore(superAdmin, STORE_B)).toBe(true);
    expect(canAccessStore(unassignedManager, STORE_A)).toBe(false);
  });

  it('builds a where-fragment that narrows for scoped principals only', () => {
    expect(storeScopeFilter(superAdmin)).toEqual({});
    expect(storeScopeFilter(managerA)).toEqual({ storeId: { in: [STORE_A] } });
    // A principal with no stores must match nothing — never everything.
    expect(storeScopeFilter(visitor)).toEqual({ storeId: { in: [] } });
    expect(storeScopeFilter(shopperA)).toEqual({ storeId: { in: [STORE_A] } });
    expect(storeScopeFilter(managerA, 'store_id')).toEqual({ store_id: { in: [STORE_A] } });
  });
});

describe('platform/authz — assertAuthorized', () => {
  it('throws AuthzError on denial and passes on a grant', () => {
    expect(() => {
      assertAuthorized(managerA, 'inventory:adjust', inB('InventoryItem'));
    }).toThrow(AuthzError);

    expect(() => {
      assertAuthorized(managerA, 'inventory:adjust', inA('InventoryItem'));
    }).not.toThrow();
  });
});

describe('order actions (Phase 4) — additive, and no existing grant moved', () => {
  const orderInA: Resource = { type: 'Order', storeId: STORE_A };
  const orderInB: Resource = { type: 'Order', storeId: STORE_B };

  it('lets a super-admin do all four, unscoped', () => {
    for (const action of [
      'order:read',
      'order:transition',
      'order:cancel',
      'order:confirm-variance',
    ] as const) {
      expect(allows(superAdmin, action, orderInA)).toBe(true);
      expect(allows(superAdmin, action, orderInB)).toBe(true);
    }
  });

  it('lets a manager do all four, but only in their own store', () => {
    for (const action of [
      'order:read',
      'order:transition',
      'order:cancel',
      'order:confirm-variance',
    ] as const) {
      expect(allows(managerA, action, orderInA)).toBe(true);
      expect(allows(managerA, action, orderInB)).toBe(false);
    }
  });

  it('lets staff read the queue and drive the lifecycle, but never cancel or confirm', () => {
    // D6: the correction and the variance confirmation are a manager's call.
    // Picking, packing and dispatch are exactly the work STORE_STAFF exists for,
    // so `order:transition` is theirs — store-scoped.
    expect(allows(staffA, 'order:read', orderInA)).toBe(true);
    expect(allows(staffA, 'order:transition', orderInA)).toBe(true);
    expect(allows(staffA, 'order:transition', orderInB)).toBe(false);
    expect(allows(staffA, 'order:cancel', orderInA)).toBe(false);
    expect(allows(staffA, 'order:confirm-variance', orderInA)).toBe(false);
  });

  it('gives a shopper none of them — there is no customer cancellation (R4)', () => {
    for (const principal of [visitor, shopperA, accountA]) {
      for (const action of [
        'order:read',
        'order:transition',
        'order:cancel',
        'order:confirm-variance',
      ] as const) {
        expect(allows(principal, action, orderInA)).toBe(false);
      }
    }
  });

  it('gives the system principal none of them', () => {
    // Placing an order is a customer use-case running as a customer; the stock
    // decrement inside it goes through `applyMovement`, which takes a `Tx` and
    // authorizes nothing. Nothing internal needs to cancel an order.
    for (const action of [
      'order:read',
      'order:transition',
      'order:cancel',
      'order:confirm-variance',
    ] as const) {
      expect(allows(system, action, orderInA)).toBe(false);
    }
  });

  it('refuses a store-scoped order action with no store on the resource', () => {
    expect(allows(managerA, 'order:cancel', { type: 'Order' })).toBe(false);
  });

  it('leaves the Phase 1-3 grant table exactly as it was', () => {
    // The boundary in the Phase 4 plan is "no changes to the RBAC rule table".
    // New actions for a new domain are additive; what must not move is any
    // decision that already existed. This pins the pre-Phase-4 action set and
    // asserts every one of those still resolves the same way for every role.
    const before: readonly Action[] = [
      'user:read',
      'user:create',
      'user:update',
      'user:disable',
      'user:reset-password',
      'store:read',
      'store:create',
      'store:update',
      'store-settings:read',
      'store-settings:update',
      'store-settings:update-pos-mode',
      'delivery-zone:read',
      'delivery-zone:write',
      'delivery-area:read',
      'delivery-area:write',
      'serviceability:resolve',
      'category:read',
      'category:write',
      'product:read',
      'product:write',
      'product-image:write',
      'store-product:read',
      'store-product:list',
      'store-product:set-price',
      'price-change:read',
      'inventory:read',
      'inventory:adjust',
      'inventory:reconcile',
      'inventory:import',
      'stock-ledger:read',
      'audit-log:read',
    ];

    expect(ALL_ACTIONS.filter((action) => !action.startsWith('order:')).sort()).toEqual(
      [...before].sort(),
    );
    expect(ALL_ACTIONS.filter((action) => action.startsWith('order:'))).toHaveLength(4);

    // A staff member still cannot write inventory; a shopper still cannot write
    // anything at all. Spot-checks of the decisions most likely to be loosened
    // by accident when a table grows.
    expect(allows(staffA, 'inventory:adjust')).toBe(false);
    expect(allows(shopperA, 'inventory:adjust')).toBe(false);
    expect(allows(managerA, 'product:write')).toBe(false);
    expect(allows(managerA, 'store-settings:update-pos-mode')).toBe(false);
  });
});
