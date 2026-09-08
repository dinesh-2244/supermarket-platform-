import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../platform/index';
import {
  assertCanAssignRole,
  assertPasswordAcceptable,
  assertRoleStorePairing,
  assignableRoles,
  descriptor,
  MIN_PASSWORD_LENGTH,
  normalizeEmail,
  principalForUser,
  SESSION_MAX_AGE_SECONDS,
  USER_ROLES,
} from '../domain/index';
import { moduleDescriptor } from '../service';

const superAdmin = { kind: 'user', userId: 'u1', role: 'SUPER_ADMIN', storeId: null } as const;
const manager = { kind: 'user', userId: 'u2', role: 'STORE_MANAGER', storeId: 's1' } as const;
const staff = { kind: 'user', userId: 'u3', role: 'STORE_STAFF', storeId: 's1' } as const;

describe('identity module descriptor', () => {
  it('declares what it owns and may depend on', () => {
    expect(moduleDescriptor()).toEqual(descriptor);
    expect(descriptor.dependsOn).toEqual(['platform']);
    expect(descriptor.emits).toEqual(['user.created', 'user.disabled']);
  });
});

describe('identity/domain — role and store pairing', () => {
  it('requires a store for every store-bound role', () => {
    expect(() => {
      assertRoleStorePairing('STORE_MANAGER', null);
    }).toThrow(ValidationError);
    expect(() => {
      assertRoleStorePairing('STORE_STAFF', null);
    }).toThrow(ValidationError);
    expect(() => {
      assertRoleStorePairing('STORE_MANAGER', 's1');
    }).not.toThrow();
  });

  // Both directions matter: authz reads a store-bound role with no store as
  // having *no* access, and a super-admin carrying a storeId would look scoped.
  it('refuses to give a SUPER_ADMIN a store', () => {
    expect(() => {
      assertRoleStorePairing('SUPER_ADMIN', 's1');
    }).toThrow(ValidationError);
    expect(() => {
      assertRoleStorePairing('SUPER_ADMIN', null);
    }).not.toThrow();
  });
});

describe('identity/domain — role assignment', () => {
  // The privilege-escalation path that store-scoped user management opens: a
  // manager who can mint another manager (or a super-admin) is unbounded.
  it('lets a manager create only staff', () => {
    expect(assignableRoles(manager)).toEqual(['STORE_STAFF']);
    expect(() => {
      assertCanAssignRole(manager, 'STORE_STAFF');
    }).not.toThrow();
    expect(() => {
      assertCanAssignRole(manager, 'STORE_MANAGER');
    }).toThrow(ValidationError);
    expect(() => {
      assertCanAssignRole(manager, 'SUPER_ADMIN');
    }).toThrow(ValidationError);
  });

  it('lets a super-admin assign any role', () => {
    expect(assignableRoles(superAdmin)).toEqual(USER_ROLES);
    for (const role of USER_ROLES) {
      expect(() => {
        assertCanAssignRole(superAdmin, role);
      }).not.toThrow();
    }
  });

  it('lets staff and customers assign nothing', () => {
    expect(assignableRoles(staff)).toEqual([]);
    expect(assignableRoles({ kind: 'customer', customerId: 'c1', storeId: null })).toEqual([]);
    expect(assignableRoles({ kind: 'system' })).toEqual([]);
  });
});

describe('identity/domain — passwords', () => {
  it('enforces a minimum length', () => {
    expect(() => {
      assertPasswordAcceptable('a'.repeat(MIN_PASSWORD_LENGTH - 1));
    }).toThrow(ValidationError);
    expect(() => {
      assertPasswordAcceptable('a'.repeat(MIN_PASSWORD_LENGTH));
    }).not.toThrow();
  });

  it('rejects whitespace padded to length', () => {
    expect(() => {
      assertPasswordAcceptable(' '.repeat(MIN_PASSWORD_LENGTH + 4));
    }).toThrow(ValidationError);
  });
});

describe('identity/domain — email normalisation', () => {
  it('lower-cases and trims so one identity cannot become two accounts', () => {
    expect(normalizeEmail('  Manager@Store.COM ')).toBe('manager@store.com');
  });

  it('rejects anything that is not an address', () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', '@c.com', 'a@.com']) {
      expect(() => normalizeEmail(bad)).toThrow(ValidationError);
    }
  });
});

describe('identity/domain — principal construction', () => {
  it('builds a principal from an active user', () => {
    expect(
      principalForUser({ id: 'u1', role: 'STORE_MANAGER', storeId: 's1', isActive: true }),
    ).toEqual({ kind: 'user', userId: 'u1', role: 'STORE_MANAGER', storeId: 's1' });
  });

  // A disabled user gets *no* principal, not a weaker one — anything holding a
  // live session fails its next authorization check rather than degrading.
  it('gives a disabled user no principal at all', () => {
    expect(
      principalForUser({ id: 'u1', role: 'SUPER_ADMIN', storeId: null, isActive: false }),
    ).toBeNull();
  });
});

describe('identity/domain — session policy', () => {
  it('has an absolute lifetime, not an idle one', () => {
    expect(SESSION_MAX_AGE_SECONDS).toBe(12 * 60 * 60);
  });
});
