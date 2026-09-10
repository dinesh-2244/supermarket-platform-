import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import {
  beginTotpEnrolment,
  changeOwnPassword,
  confirmTotpEnrolment,
  createUser,
  disableTotp,
  hasTotpEnrolled,
  verifyCredentials,
} from '@/modules/identity';
import { TOTP_PERIOD_SECONDS, totpCodeAt } from '@/modules/identity/domain/totp';
import { createStore } from '../factories/index';

/**
 * P2 — optional TOTP, against a real database.
 *
 * The unit suite proves the algorithm against RFC 6238's own vectors. This
 * proves the *policy* around it: that nothing is stored until a code has proved
 * the app holds the secret, that once it is stored **sign-in requires it**, and
 * that the re-authentication used elsewhere (changing your password) is not
 * quietly turned into a second code prompt.
 */
const prisma = getPrisma();

const PASSWORD = 'CorrectHorseBattery1';
const WRONG_PASSWORD = 'NotThePasswordAtAll7';

let storeId: string;
let admin: Principal;
const createdUserIds: string[] = [];

const bootstrap: Principal = {
  kind: 'user',
  userId: 'bootstrap',
  role: 'SUPER_ADMIN',
  storeId: null,
};

function unique(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}@example.test`;
}

/** A fresh staff account plus the principal that acts as it. */
async function newStaff(
  prefix: string,
): Promise<{ id: string; email: string; principal: Principal }> {
  const row = await createUser(admin, {
    email: unique(prefix),
    name: 'TOTP Subject',
    password: PASSWORD,
    role: 'STORE_STAFF',
    storeId,
  });
  createdUserIds.push(row.id);
  return {
    id: row.id,
    email: row.email,
    principal: { kind: 'user', userId: row.id, role: 'STORE_STAFF', storeId },
  };
}

function storedSecret(userId: string): Promise<string | null> {
  return prisma.user
    .findUniqueOrThrow({ where: { id: userId }, select: { twoFactorSecret: true } })
    .then((row) => row.twoFactorSecret);
}

beforeAll(async () => {
  const store = await createStore(prisma, { code: `TOT-${Date.now() % 100000}` });
  storeId = store.id;

  const adminRow = await createUser(bootstrap, {
    email: unique('totp-admin'),
    name: 'Super Admin',
    password: PASSWORD,
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  createdUserIds.push(adminRow.id);
  admin = { kind: 'user', userId: adminRow.id, role: 'SUPER_ADMIN', storeId: null };
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { storeId } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.$disconnect();
});

describe('identity — enrolling a second factor', () => {
  let staff: { id: string; email: string; principal: Principal };

  beforeEach(async () => {
    staff = await newStaff('enrol');
  });

  it('mints a secret and a scannable URI without storing anything', async () => {
    const enrolment = await beginTotpEnrolment(staff.principal);

    expect(enrolment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrolment.uri).toContain(`secret=${enrolment.secret}`);
    // The label is the email, so the authenticator entry says which login it is.
    expect(decodeURIComponent(enrolment.uri)).toContain(staff.email);

    // Closing the tab here must leave the account exactly as it was — a stored
    // secret with nobody holding it is a lockout, not a security measure.
    expect(await storedSecret(staff.id)).toBeNull();
    expect(await hasTotpEnrolled(staff.principal)).toBe(false);
  });

  it('hands out a different secret each time it is asked', async () => {
    const first = await beginTotpEnrolment(staff.principal);
    const second = await beginTotpEnrolment(staff.principal);
    expect(first.secret).not.toBe(second.secret);
  });

  it('refuses to store the secret without the current password', async () => {
    const { secret } = await beginTotpEnrolment(staff.principal);
    const now = Date.now();

    await expect(
      confirmTotpEnrolment(
        staff.principal,
        { secret, code: await totpCodeAt(secret, now), password: WRONG_PASSWORD },
        now,
      ),
    ).rejects.toThrow(/password is not correct/i);

    expect(await storedSecret(staff.id)).toBeNull();
  });

  it('refuses to store the secret without a code it produced', async () => {
    const { secret } = await beginTotpEnrolment(staff.principal);
    const other = await beginTotpEnrolment(staff.principal);
    const now = Date.now();

    // A well-formed six digits — from the *wrong* secret.
    await expect(
      confirmTotpEnrolment(
        staff.principal,
        { secret, code: await totpCodeAt(other.secret, now), password: PASSWORD },
        now,
      ),
    ).rejects.toThrow(/does not match/i);

    expect(await storedSecret(staff.id)).toBeNull();
  });

  it('stores the secret and audits the change once both are right', async () => {
    const { secret } = await beginTotpEnrolment(staff.principal);
    const now = Date.now();

    await confirmTotpEnrolment(
      staff.principal,
      { secret, code: await totpCodeAt(secret, now), password: PASSWORD },
      now,
    );

    expect(await storedSecret(staff.id)).toBe(secret);
    expect(await hasTotpEnrolled(staff.principal)).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { actorId: staff.id, entityType: 'User', entityId: staff.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.afterJson).toMatchObject({ twoFactorEnrolled: true });
    // The secret itself is not evidence anybody needs in a log.
    expect(JSON.stringify(audit)).not.toContain(secret);
  });
});

describe('identity — signing in with a second factor', () => {
  let staff: { id: string; email: string; principal: Principal };
  let secret: string;
  let now: number;

  beforeEach(async () => {
    staff = await newStaff('signin');
    now = Date.now();
    secret = (await beginTotpEnrolment(staff.principal)).secret;
    await confirmTotpEnrolment(
      staff.principal,
      { secret, code: await totpCodeAt(secret, now), password: PASSWORD },
      now,
    );
  });

  it('accepts the password plus a current code', async () => {
    const user = await verifyCredentials(staff.email, PASSWORD, await totpCodeAt(secret, now), now);
    expect(user?.id).toBe(staff.id);
  });

  it('rejects the right password on its own', async () => {
    expect(await verifyCredentials(staff.email, PASSWORD, '', now)).toBeNull();
  });

  it('rejects a wrong code, and does not stamp a sign-in for it', async () => {
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: staff.id },
      select: { lastLoginAt: true },
    });

    expect(await verifyCredentials(staff.email, PASSWORD, '000000', now)).toBeNull();

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: staff.id },
      select: { lastLoginAt: true },
    });
    expect(after.lastLoginAt).toEqual(before.lastLoginAt);
  });

  it('accepts the previous step but not the one before it', async () => {
    const period = TOTP_PERIOD_SECONDS * 1000;
    const previous = await totpCodeAt(secret, now - period);
    const older = await totpCodeAt(secret, now - 2 * period);

    expect(await verifyCredentials(staff.email, PASSWORD, previous, now)).not.toBeNull();
    expect(await verifyCredentials(staff.email, PASSWORD, older, now)).toBeNull();
  });

  it('still lets the owner change their password with the password alone', async () => {
    // Re-authentication is not sign-in: the session already exists, and asking
    // the same authenticator twice protects nothing.
    await changeOwnPassword(staff.principal, PASSWORD, 'AnotherLongPassword9');
    expect(
      await verifyCredentials(
        staff.email,
        'AnotherLongPassword9',
        await totpCodeAt(secret, now),
        now,
      ),
    ).not.toBeNull();
  });
});

describe('identity — withdrawing a second factor', () => {
  let staff: { id: string; email: string; principal: Principal };
  let secret: string;
  let now: number;

  beforeEach(async () => {
    staff = await newStaff('disable');
    now = Date.now();
    secret = (await beginTotpEnrolment(staff.principal)).secret;
    await confirmTotpEnrolment(
      staff.principal,
      { secret, code: await totpCodeAt(secret, now), password: PASSWORD },
      now,
    );
  });

  it('needs a current code as well as the password', async () => {
    await expect(
      disableTotp(staff.principal, { code: '000000', password: PASSWORD }, now),
    ).rejects.toThrow(/does not match/i);
    await expect(
      disableTotp(
        staff.principal,
        { code: await totpCodeAt(secret, now), password: WRONG_PASSWORD },
        now,
      ),
    ).rejects.toThrow(/password is not correct/i);

    expect(await storedSecret(staff.id)).toBe(secret);
  });

  it('clears the secret and returns sign-in to the password alone', async () => {
    await disableTotp(
      staff.principal,
      { code: await totpCodeAt(secret, now), password: PASSWORD },
      now,
    );

    expect(await storedSecret(staff.id)).toBeNull();
    expect(await verifyCredentials(staff.email, PASSWORD, '', now)).not.toBeNull();
  });

  it('refuses when there is nothing enrolled', async () => {
    const other = await newStaff('never-enrolled');
    await expect(
      disableTotp(other.principal, { code: '000000', password: PASSWORD }, now),
    ).rejects.toThrow(/do not have a second factor/i);
  });
});
