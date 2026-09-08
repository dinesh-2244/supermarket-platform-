import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import {
  changeOwnPassword,
  createSessionForUser,
  createUser,
  destroySession,
  getUser,
  listUsers,
  readSession,
  resetPassword,
  setUserActive,
  updateUser,
  verifyCredentials,
} from '@/modules/identity';
import { createStore } from '../factories/index';

/**
 * P2-1 — staff auth and tenancy isolation, against a real database.
 *
 * The unit suite proves the rule table; this proves the rules survive contact
 * with Prisma: that the queries actually filter, that a session is a row and not
 * a token, and that disabling someone takes their live session with it.
 */
const prisma = getPrisma();

const PASSWORD = 'CorrectHorseBattery1';
const OTHER_PASSWORD = 'AnotherLongPassword9';

let storeA: string;
let storeB: string;
let admin: Principal;
let managerA: Principal;
let managerB: Principal;
let managerAId: string;
const createdUserIds: string[] = [];

/** The bootstrap principal — the seeded super-admin the back office starts from. */
const bootstrap: Principal = {
  kind: 'user',
  userId: 'bootstrap',
  role: 'SUPER_ADMIN',
  storeId: null,
};

function unique(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}@example.test`;
}

beforeAll(async () => {
  const a = await createStore(prisma, { code: `IDA-${Date.now() % 100000}` });
  const b = await createStore(prisma, { code: `IDB-${Date.now() % 100000}` });
  storeA = a.id;
  storeB = b.id;

  const adminRow = await createUser(bootstrap, {
    email: unique('admin'),
    name: 'Super Admin',
    password: PASSWORD,
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  createdUserIds.push(adminRow.id);
  admin = { kind: 'user', userId: adminRow.id, role: 'SUPER_ADMIN', storeId: null };

  const mA = await createUser(admin, {
    email: unique('mgr-a'),
    name: 'Manager A',
    password: PASSWORD,
    role: 'STORE_MANAGER',
    storeId: storeA,
  });
  const mB = await createUser(admin, {
    email: unique('mgr-b'),
    name: 'Manager B',
    password: PASSWORD,
    role: 'STORE_MANAGER',
    storeId: storeB,
  });
  createdUserIds.push(mA.id, mB.id);
  managerAId = mA.id;
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { storeId: { in: [storeA, storeB] } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.store.deleteMany({ where: { id: { in: [storeA, storeB] } } });
  await prisma.$disconnect();
});

describe('identity — credentials', () => {
  it('signs a user in with the right password', async () => {
    const row = await createUser(admin, {
      email: unique('login-ok'),
      name: 'Login OK',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);

    const user = await verifyCredentials(row.email, PASSWORD);
    expect(user?.id).toBe(row.id);
    expect(user?.role).toBe('STORE_STAFF');
  });

  it('stores an argon2id hash, never the password', async () => {
    const row = await prisma.user.findUniqueOrThrow({ where: { id: managerAId } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);
  });

  it('is case-insensitive on the email but not the password', async () => {
    const row = await createUser(admin, {
      email: unique('Case-Test'),
      name: 'Case',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);

    await expect(verifyCredentials(row.email.toUpperCase(), PASSWORD)).resolves.not.toBeNull();
    await expect(verifyCredentials(row.email, PASSWORD.toUpperCase())).resolves.toBeNull();
  });

  // One undifferentiated failure: the form must not double as an oracle telling
  // an attacker which addresses have accounts.
  it('returns the same null for unknown email, wrong password and disabled user', async () => {
    const row = await createUser(admin, {
      email: unique('disabled'),
      name: 'Disabled',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);
    await setUserActive(admin, row.id, false);

    expect(await verifyCredentials(unique('nobody'), PASSWORD)).toBeNull();
    expect(await verifyCredentials(row.email, 'WrongPassword12345')).toBeNull();
    expect(await verifyCredentials(row.email, PASSWORD)).toBeNull();
    expect(await verifyCredentials('not-an-email', PASSWORD)).toBeNull();
  });
});

describe('identity — sessions live in the database', () => {
  it('mints a row, resolves it to a principal, and drops it on sign-out', async () => {
    const { token } = await createSessionForUser(managerAId);

    const stored = await prisma.session.findUnique({ where: { sessionToken: token } });
    expect(stored?.userId).toBe(managerAId);
    // Opaque: nothing about role or store is in the token itself.
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const active = await readSession(token);
    expect(active?.principal).toEqual({
      kind: 'user',
      userId: managerAId,
      role: 'STORE_MANAGER',
      storeId: storeA,
    });

    await destroySession(token);
    expect(await readSession(token)).toBeNull();
    expect(await prisma.session.findUnique({ where: { sessionToken: token } })).toBeNull();
  });

  // Rotation: a new login never re-blesses an old token.
  it('issues a distinct token on every sign-in', async () => {
    const first = await createSessionForUser(managerAId);
    const second = await createSessionForUser(managerAId);

    expect(first.token).not.toBe(second.token);
    expect(await readSession(first.token)).not.toBeNull();
    expect(await readSession(second.token)).not.toBeNull();

    await destroySession(first.token);
    await destroySession(second.token);
  });

  it('refuses an expired row and cleans it up as it goes', async () => {
    const { token } = await createSessionForUser(managerAId);
    await prisma.session.update({
      where: { sessionToken: token },
      data: { expires: new Date(Date.now() - 1000) },
    });

    expect(await readSession(token)).toBeNull();
    expect(await prisma.session.findUnique({ where: { sessionToken: token } })).toBeNull();
  });

  // The property a stateless JWT cannot give: revocation.
  it('kills live sessions when the user is disabled', async () => {
    const row = await createUser(admin, {
      email: unique('evicted'),
      name: 'Evicted',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);
    const { token } = await createSessionForUser(row.id);
    expect(await readSession(token)).not.toBeNull();

    await setUserActive(admin, row.id, false);

    expect(await readSession(token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: row.id } })).toBe(0);
  });

  it('kills live sessions when the user’s store or role changes', async () => {
    const row = await createUser(admin, {
      email: unique('moved'),
      name: 'Moved',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);
    const { token } = await createSessionForUser(row.id);

    await updateUser(admin, row.id, { storeId: storeB });

    expect(await readSession(token)).toBeNull();
  });

  it('kills live sessions on an admin password reset', async () => {
    const row = await createUser(admin, {
      email: unique('reset'),
      name: 'Reset',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);
    const { token } = await createSessionForUser(row.id);

    await resetPassword(admin, row.id, OTHER_PASSWORD);

    expect(await readSession(token)).toBeNull();
    expect(await verifyCredentials(row.email, PASSWORD)).toBeNull();
    expect(await verifyCredentials(row.email, OTHER_PASSWORD)).not.toBeNull();
  });
});

describe('identity — cross-store denial (server-side, not UI-hidden)', () => {
  it('refuses a manager every write into another store', async () => {
    await expect(
      createUser(managerA, {
        email: unique('poach'),
        name: 'Poached',
        password: PASSWORD,
        role: 'STORE_STAFF',
        storeId: storeB,
      }),
    ).rejects.toThrow(/permission/i);

    const victim = await createUser(admin, {
      email: unique('b-staff'),
      name: 'B Staff',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeB,
    });
    createdUserIds.push(victim.id);

    await expect(updateUser(managerA, victim.id, { name: 'Renamed' })).rejects.toThrow(
      /permission/i,
    );
    await expect(setUserActive(managerA, victim.id, false)).rejects.toThrow(/permission/i);
    await expect(resetPassword(managerA, victim.id, OTHER_PASSWORD)).rejects.toThrow(/permission/i);
    await expect(getUser(managerA, victim.id)).rejects.toThrow(/permission/i);

    // …and manager B may do all of it, so the refusal is about the store, not the role.
    await expect(updateUser(managerB, victim.id, { name: 'Renamed by B' })).resolves.toMatchObject({
      name: 'Renamed by B',
    });
  });

  it('refuses a manager the privilege escalation of minting a peer', async () => {
    // Authorized for its own store, then stopped by the role rule: a manager who
    // can mint another manager is unbounded.
    await expect(
      createUser(managerA, {
        email: unique('peer'),
        name: 'Peer',
        password: PASSWORD,
        role: 'STORE_MANAGER',
        storeId: storeA,
      }),
    ).rejects.toThrow(/may not assign that role/i);

    // A SUPER_ADMIN has no store at all, so it fails one gate earlier: a
    // store-scoped grant cannot authorise a resource that names no store.
    await expect(
      createUser(managerA, {
        email: unique('root'),
        name: 'Root',
        password: PASSWORD,
        role: 'SUPER_ADMIN',
        storeId: null,
      }),
    ).rejects.toThrow(/permission/i);
  });

  it('refuses a manager moving their own staff into another store', async () => {
    const mine = await createUser(managerA, {
      email: unique('mine'),
      name: 'Mine',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(mine.id);

    await expect(updateUser(managerA, mine.id, { storeId: storeB })).rejects.toThrow(/permission/i);
  });

  // The list query itself must filter — not the template that renders it.
  it('shows a manager only their own store’s users, never another store’s', async () => {
    const visible = await listUsers(managerA);
    const storeIds = new Set(visible.map((user) => user.storeId));

    expect(storeIds).toEqual(new Set([storeA]));
    expect(visible.some((user) => user.role === 'SUPER_ADMIN')).toBe(false);

    const all = await listUsers(admin);
    expect(all.length).toBeGreaterThan(visible.length);
    expect(all.some((user) => user.storeId === storeB)).toBe(true);
  });

  it('refuses staff any user management at all', async () => {
    const staffRow = await createUser(admin, {
      email: unique('staff'),
      name: 'Staff',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(staffRow.id);
    const staff: Principal = {
      kind: 'user',
      userId: staffRow.id,
      role: 'STORE_STAFF',
      storeId: storeA,
    };

    await expect(listUsers(staff)).rejects.toThrow(/permission/i);
    await expect(
      createUser(staff, {
        email: unique('nope'),
        name: 'Nope',
        password: PASSWORD,
        role: 'STORE_STAFF',
        storeId: storeA,
      }),
    ).rejects.toThrow(/permission/i);
  });
});

/**
 * R1 — a STORE_MANAGER runs their store's *staff*, not their peers.
 *
 * The Phase 2 checks authorized the target's store but only ever looked at the
 * *proposed* role, so a manager could reset, demote or disable another manager
 * in the same store: the store matched, and STORE_STAFF was a role they were
 * allowed to assign. Two managers could evict or take over one another.
 */
describe('identity — a manager cannot manage a peer manager (R1)', () => {
  let peerId: string;
  let peerEmail: string;
  let managerAOwnStaffId: string;

  beforeAll(async () => {
    const peer = await createUser(admin, {
      email: unique('peer-mgr'),
      name: 'Peer Manager',
      password: PASSWORD,
      role: 'STORE_MANAGER',
      storeId: storeA,
    });
    peerId = peer.id;
    peerEmail = peer.email;
    createdUserIds.push(peer.id);

    const staff = await createUser(managerA, {
      email: unique('a-staff'),
      name: 'A Staff',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    managerAOwnStaffId = staff.id;
    createdUserIds.push(staff.id);
  });

  it('refuses to reset a peer manager’s password — and the old one still works', async () => {
    await expect(resetPassword(managerA, peerId, OTHER_PASSWORD)).rejects.toThrow(/permission/i);

    // The exact check OSCAR ran: the peer's original credentials are intact.
    expect(await verifyCredentials(peerEmail, OTHER_PASSWORD)).toBeNull();
    expect(await verifyCredentials(peerEmail, PASSWORD)).not.toBeNull();
  });

  it('refuses to demote a peer manager', async () => {
    await expect(updateUser(managerA, peerId, { role: 'STORE_STAFF' })).rejects.toThrow(
      /permission/i,
    );
    expect((await getUser(admin, peerId)).role).toBe('STORE_MANAGER');
  });

  it('refuses to disable a peer manager', async () => {
    await expect(setUserActive(managerA, peerId, false)).rejects.toThrow(/permission/i);
    expect((await getUser(admin, peerId)).isActive).toBe(true);
  });

  it('refuses to even read a peer manager', async () => {
    await expect(getUser(managerA, peerId)).rejects.toThrow(/permission/i);
  });

  it('does not show a peer manager in the list that offers those actions', async () => {
    const visible = await listUsers(managerA);
    expect(visible.map((user) => user.id)).not.toContain(peerId);
    // …but their own staff are there, so the list is not simply empty.
    expect(visible.map((user) => user.id)).toContain(managerAOwnStaffId);
    expect(visible.every((user) => user.role === 'STORE_STAFF')).toBe(true);
  });

  it('still lets a manager manage their own staff', async () => {
    await expect(
      updateUser(managerA, managerAOwnStaffId, { name: 'A Staff Renamed' }),
    ).resolves.toMatchObject({ name: 'A Staff Renamed' });
    await expect(
      resetPassword(managerA, managerAOwnStaffId, OTHER_PASSWORD),
    ).resolves.toBeUndefined();
    await setUserActive(managerA, managerAOwnStaffId, false);
    await setUserActive(managerA, managerAOwnStaffId, true);
  });

  it('refuses another store’s staff, so the store check still applies too', async () => {
    const otherStaff = await createUser(admin, {
      email: unique('b-staff-r1'),
      name: 'B Staff',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeB,
    });
    createdUserIds.push(otherStaff.id);

    await expect(resetPassword(managerA, otherStaff.id, OTHER_PASSWORD)).rejects.toThrow(
      /permission/i,
    );
    await expect(setUserActive(managerA, otherStaff.id, false)).rejects.toThrow(/permission/i);
  });

  it('refuses a SUPER_ADMIN target outright', async () => {
    const adminId = admin.kind === 'user' ? admin.userId : '';
    await expect(resetPassword(managerA, adminId, OTHER_PASSWORD)).rejects.toThrow(/permission/i);
    await expect(setUserActive(managerA, adminId, false)).rejects.toThrow(/permission/i);
  });

  it('still lets a super-admin manage managers', async () => {
    await expect(updateUser(admin, peerId, { name: 'Peer Renamed' })).resolves.toMatchObject({
      name: 'Peer Renamed',
    });
  });
});

describe('identity — audit and safety rails', () => {
  it('writes a before/after AuditLog row for every user mutation', async () => {
    const row = await createUser(admin, {
      email: unique('audited'),
      name: 'Audited',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);
    await updateUser(admin, row.id, { name: 'Audited Twice' });
    await setUserActive(admin, row.id, false);

    const entries = await prisma.auditLog.findMany({
      where: { entityType: 'User', entityId: row.id },
      orderBy: { createdAt: 'asc' },
    });

    expect(entries.map((entry) => entry.action)).toEqual(['create', 'update', 'disable']);
    expect(entries.every((entry) => entry.actorType === 'USER')).toBe(true);
    expect(entries[0]?.beforeJson).toBeNull();
    expect(entries[1]?.beforeJson).toMatchObject({ name: 'Audited' });
    expect(entries[1]?.afterJson).toMatchObject({ name: 'Audited Twice' });
  });

  it('never records a password hash in the audit trail', async () => {
    const row = await createUser(admin, {
      email: unique('secret'),
      name: 'Secret',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);
    await resetPassword(admin, row.id, OTHER_PASSWORD);

    const entries = await prisma.auditLog.findMany({
      where: { entityType: 'User', entityId: row.id },
    });
    const serialised = JSON.stringify(entries);

    expect(serialised).not.toContain('argon2');
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain(OTHER_PASSWORD);
    expect(serialised).not.toContain('passwordHash');
  });

  it('refuses to create a store-bound role with no store, or a scoped super-admin', async () => {
    await expect(
      createUser(admin, {
        email: unique('bad'),
        name: 'Bad',
        password: PASSWORD,
        role: 'STORE_MANAGER',
        storeId: null,
      }),
    ).rejects.toThrow(/must be assigned to a store/i);

    await expect(
      createUser(admin, {
        email: unique('bad2'),
        name: 'Bad2',
        password: PASSWORD,
        role: 'SUPER_ADMIN',
        storeId: storeA,
      }),
    ).rejects.toThrow(/not scoped to a store/i);
  });

  it('rejects a duplicate email as a conflict, not a crash', async () => {
    const email = unique('dupe');
    const row = await createUser(admin, {
      email,
      name: 'First',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);

    await expect(
      createUser(admin, {
        email: email.toUpperCase(),
        name: 'Second',
        password: PASSWORD,
        role: 'STORE_STAFF',
        storeId: storeA,
      }),
    ).rejects.toThrow(/already exists/i);
  });

  it('refuses to disable the last active SUPER_ADMIN or yourself', async () => {
    await expect(
      setUserActive(admin, admin.kind === 'user' ? admin.userId : '', false),
    ).rejects.toThrow(/your own account/i);
  });

  it('requires the current password to change your own', async () => {
    const row = await createUser(admin, {
      email: unique('self'),
      name: 'Self',
      password: PASSWORD,
      role: 'STORE_STAFF',
      storeId: storeA,
    });
    createdUserIds.push(row.id);
    const self: Principal = { kind: 'user', userId: row.id, role: 'STORE_STAFF', storeId: storeA };

    await expect(changeOwnPassword(self, 'WrongCurrent12345', OTHER_PASSWORD)).rejects.toThrow(
      /not correct/i,
    );
    await changeOwnPassword(self, PASSWORD, OTHER_PASSWORD);
    expect(await verifyCredentials(row.email, OTHER_PASSWORD)).not.toBeNull();
  });

  it('rejects a password shorter than the minimum', async () => {
    await expect(
      createUser(admin, {
        email: unique('short'),
        name: 'Short',
        password: 'short',
        role: 'STORE_STAFF',
        storeId: storeA,
      }),
    ).rejects.toThrow(/at least/i);
  });
});
