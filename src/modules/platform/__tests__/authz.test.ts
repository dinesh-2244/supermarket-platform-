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
const guest = { kind: 'customer', customerId: 'c1' } as const;
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

describe('platform/authz — deny by default', () => {
  it('denies every action to a customer principal', () => {
    for (const action of ALL_ACTIONS) {
      expect(allows(guest, action)).toBe(false);
    }
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
    expect(allowedStoreIds(guest)).toEqual([]);
  });

  it('isUnscoped agrees with allowedStoreIds', () => {
    expect(isUnscoped(superAdmin)).toBe(true);
    expect(isUnscoped(system)).toBe(true);
    expect(isUnscoped(managerA)).toBe(false);
    expect(isUnscoped(guest)).toBe(false);
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
    expect(storeScopeFilter(guest)).toEqual({ storeId: { in: [] } });
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
