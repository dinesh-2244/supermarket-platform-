import { describe, expect, it } from 'vitest';
import {
  allowedStoreIds,
  assertAuthorized,
  authorize,
  AUTHZ_ACCEPTED_EXCEPTIONS,
  isUnscoped,
} from '../authz/index';
import { AuthzError } from '../errors/index';

const superAdmin = { kind: 'user', userId: 'u1', role: 'SUPER_ADMIN', storeId: null } as const;
const manager = { kind: 'user', userId: 'u2', role: 'STORE_MANAGER', storeId: 'store-1' } as const;
const guest = { kind: 'customer', customerId: 'c1' } as const;

describe('platform/authz', () => {
  // The only two grants that exist before the rule table does. They are an
  // accepted, documented deviation from deny-everything (see authz/index.ts);
  // this test is what makes widening or removing them a deliberate act.
  it('grants exactly two privileged principals while the rule table is empty', () => {
    expect(AUTHZ_ACCEPTED_EXCEPTIONS).toEqual(['system principal', 'SUPER_ADMIN']);

    const system = { kind: 'system' } as const;
    expect(authorize(system, 'inventory:adjust', { type: 'InventoryItem' })).toEqual({
      allowed: true,
      reason: 'system principal',
    });
    expect(authorize(superAdmin, 'inventory:adjust', { type: 'InventoryItem' })).toEqual({
      allowed: true,
      reason: 'SUPER_ADMIN',
    });

    const staff = { kind: 'user', userId: 'u3', role: 'STORE_STAFF', storeId: 'store-1' } as const;
    for (const principal of [manager, staff, guest] as const) {
      expect(authorize(principal, 'inventory:adjust', { type: 'InventoryItem' }).allowed).toBe(
        false,
      );
    }
  });

  it('denies by default', () => {
    const decision = authorize(manager, 'inventory:adjust', { type: 'InventoryItem' });
    expect(decision.allowed).toBe(false);
  });

  it('denies customers', () => {
    expect(authorize(guest, 'order:transition', { type: 'Order' }).allowed).toBe(false);
  });

  it('allows SUPER_ADMIN and system', () => {
    expect(authorize(superAdmin, 'inventory:adjust', { type: 'InventoryItem' }).allowed).toBe(true);
    expect(authorize({ kind: 'system' }, 'order:transition', { type: 'Order' }).allowed).toBe(true);
  });

  it('reports out-of-scope stores before falling through to deny', () => {
    const decision = authorize(manager, 'order:transition', { type: 'Order', storeId: 'store-2' });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('store-2');
  });

  it('scopes a store user to their own store only', () => {
    expect(allowedStoreIds(manager)).toEqual(['store-1']);
    expect(allowedStoreIds(superAdmin)).toEqual([]);
    expect(allowedStoreIds(guest)).toEqual([]);
    expect(isUnscoped(superAdmin)).toBe(true);
    expect(isUnscoped(manager)).toBe(false);
  });

  it('throws AuthzError from the asserting form', () => {
    expect(() => assertAuthorized(manager, 'user:create', { type: 'User' })).toThrow(AuthzError);
    expect(() => assertAuthorized(superAdmin, 'user:create', { type: 'User' })).not.toThrow();
  });
});
