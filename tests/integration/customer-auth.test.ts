import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { addItem, ensureCart, adoptCart } from '@/modules/cart';
import { createCategory, createProduct } from '@/modules/catalog';
import {
  changePassword,
  createSessionForCustomer,
  destroyCustomerSession,
  getProfile,
  readCustomerSession,
  signUp,
  updateProfile,
  verifyCustomerCredentials,
} from '@/modules/customers';
import { createUser, listUsers, readSession } from '@/modules/identity';
import { adjustStock, listStock } from '@/modules/inventory';
import { setPrice } from '@/modules/pricing';
import { auditEntries } from '@/modules/admin';
import { getSettings } from '@/modules/stores';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * P3-6 — customer accounts, and the wall between a shopper and a member of
 * staff (ADR-0010).
 *
 * The isolation is the point of this file. It is asserted in both directions and
 * at both levels: a customer session must be worthless to the back office, and a
 * staff session must be worthless to the account area — not because a page hides
 * a link, but because the two credentials name rows in different tables.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;
const PASSWORD = 'ShopperPass123';

let admin: Principal;
let adminUserId: string;
let storeA: string;
let categoryId: string;
let productId: string;
let customerId: string;
let otherCustomerId: string;
const cartTokens: string[] = [];
const emails = {
  mine: `shopper-${suffix}@example.test`,
  other: `other-${suffix}@example.test`,
};

async function signUpAndFind(email: string, phone: string, name: string): Promise<string> {
  await signUp({ name, email, phone, password: PASSWORD });
  const row = await prisma.customer.findUniqueOrThrow({ where: { email } });
  return row.id;
}

beforeAll(async () => {
  const bootstrap: Principal = {
    kind: 'user',
    userId: 'cust-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const adminRow = await createUser(bootstrap, {
    email: `cust-admin-${suffix}@example.test`,
    name: 'Customer Admin',
    password: 'CustomerAdminPass123',
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  adminUserId = adminRow.id;
  admin = { kind: 'user', userId: adminUserId, role: 'SUPER_ADMIN', storeId: null };

  const store = await createStore(prisma, { code: `CUA-${suffix.slice(-5)}` });
  storeA = store.id;
  await createStoreSettings(prisma, storeA);

  categoryId = (await createCategory(admin, { name: `Customer ${suffix}` })).id;
  productId = (
    await createProduct(admin, {
      sku: `CUST-${suffix}`,
      name: `Customer Product ${suffix}`,
      packSize: '1 kg',
      categoryId,
    })
  ).id;
  await setPrice(admin, storeA, productId, { mrpPaise: 5_000, sellingPricePaise: 4_000 });
  await prisma.inventoryItem.create({
    data: { storeId: storeA, productId, websiteStock: 30 },
  });

  customerId = await signUpAndFind(emails.mine, `98${suffix.padStart(8, '0')}`, 'A Shopper');
  otherCustomerId = await signUpAndFind(
    emails.other,
    `97${suffix.padStart(8, '0')}`,
    'Another Shopper',
  );
});

afterAll(async () => {
  const customers = [customerId, otherCustomerId];
  await prisma.cartItem.deleteMany({ where: { cart: { cartToken: { in: cartTokens } } } });
  await prisma.cart.deleteMany({ where: { cartToken: { in: cartTokens } } });
  await prisma.customerSession.deleteMany({ where: { customerId: { in: customers } } });
  await prisma.customerAddress.deleteMany({ where: { customerId: { in: customers } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  await prisma.auditLog.deleteMany({
    where: { actorId: { in: [adminUserId, 'cust-bootstrap'] } },
  });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: storeA } } });
  await prisma.stockLedger.deleteMany({ where: { storeId: storeA } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: storeA } });
  await prisma.storeProduct.deleteMany({ where: { storeId: storeA } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId: storeA } });
  await prisma.store.deleteMany({ where: { id: storeA } });
  await prisma.session.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.deleteMany({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('P3-6 — signing up', () => {
  it('stores an argon2id hash, never the password', async () => {
    const row = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain(PASSWORD);
  });

  /**
   * The enumeration defence: sign-up does not sign anyone in, and says the same
   * thing either way. Any flow that signed you in would leak whether the
   * address was taken, because being signed in and not being signed in are
   * different outcomes however the message is worded.
   */
  it('gives the same answer for a new address and a taken one', async () => {
    const fresh = `fresh-${suffix}@example.test`;
    await expect(
      signUp({
        name: 'Fresh',
        email: fresh,
        phone: `96${suffix.padStart(8, '0')}`,
        password: PASSWORD,
      }),
    ).resolves.toBeUndefined();
    // Same call, same (absence of a) result, for an address that already exists.
    await expect(
      signUp({
        name: 'Impostor',
        email: emails.mine,
        phone: `95${suffix.padStart(8, '0')}`,
        password: PASSWORD,
      }),
    ).resolves.toBeUndefined();

    // …and the existing account is untouched: still one row, still theirs.
    expect(await prisma.customer.count({ where: { email: emails.mine } })).toBe(1);
    expect((await prisma.customer.findUniqueOrThrow({ where: { email: emails.mine } })).name).toBe(
      'A Shopper',
    );

    await prisma.customer.deleteMany({ where: { email: fresh } });
  });

  it('refuses a bad email, a bad phone and a short password', async () => {
    const base = { name: 'X', email: `ok-${suffix}@example.test`, phone: '9876543210' };
    await expect(signUp({ ...base, email: 'not-an-email', password: PASSWORD })).rejects.toThrow(
      /valid email/i,
    );
    await expect(signUp({ ...base, phone: '12345', password: PASSWORD })).rejects.toThrow(
      /10-digit/i,
    );
    await expect(signUp({ ...base, password: 'short' })).rejects.toThrow(/at least/i);
  });
});

describe('P3-6 — signing in', () => {
  it('accepts the right password and refuses everything else identically', async () => {
    await expect(verifyCustomerCredentials(emails.mine, PASSWORD)).resolves.toMatchObject({
      id: customerId,
    });

    // Unknown address, wrong password and a malformed address are one answer.
    expect(await verifyCustomerCredentials(emails.mine, 'WrongPassword1')).toBeNull();
    expect(await verifyCustomerCredentials(`nobody-${suffix}@example.test`, PASSWORD)).toBeNull();
    expect(await verifyCustomerCredentials('not-an-email', PASSWORD)).toBeNull();
  });

  it('refuses a blocked account without saying so', async () => {
    await prisma.customer.update({ where: { id: otherCustomerId }, data: { isBlocked: true } });
    try {
      expect(await verifyCustomerCredentials(emails.other, PASSWORD)).toBeNull();
    } finally {
      await prisma.customer.update({ where: { id: otherCustomerId }, data: { isBlocked: false } });
    }
  });

  it('mints a session that resolves to a customer principal', async () => {
    const { token } = await createSessionForCustomer(customerId);
    const session = await readCustomerSession(token, storeA);

    expect(session?.principal).toEqual({ kind: 'customer', customerId, storeId: storeA });
    expect(session?.customer.name).toBe('A Shopper');

    // Signing out makes the cookie worthless immediately.
    await destroyCustomerSession(token);
    expect(await readCustomerSession(token, storeA)).toBeNull();
  });

  it('drops an expired session as it finds it', async () => {
    const { token } = await createSessionForCustomer(customerId);
    await prisma.customerSession.update({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    expect(await readCustomerSession(token)).toBeNull();
    expect(await prisma.customerSession.count({ where: { token } })).toBe(0);
  });

  it('stops honouring a session as soon as the account is blocked', async () => {
    const { token } = await createSessionForCustomer(customerId);
    await prisma.customer.update({ where: { id: customerId }, data: { isBlocked: true } });
    try {
      // Re-read every request, so this takes effect on the next page load.
      expect(await readCustomerSession(token)).toBeNull();
    } finally {
      await prisma.customer.update({ where: { id: customerId }, data: { isBlocked: false } });
    }
  });
});

describe('P3-6 — a shopper and a member of staff are different people', () => {
  it('gives a customer session no back-office access whatsoever', async () => {
    const { token } = await createSessionForCustomer(customerId);
    const session = await readCustomerSession(token, storeA);
    const principal = session!.principal;

    // Reads the back office owns.
    await expect(listUsers(principal)).rejects.toThrow(/permission/i);
    await expect(auditEntries(principal)).rejects.toThrow(/permission/i);
    await expect(getSettings(principal, storeA)).rejects.toThrow(/permission/i);
    await expect(listStock(principal, { storeId: storeA })).rejects.toThrow(/permission/i);
    // …and every write.
    await expect(adjustStock(principal, { storeId: storeA, productId, delta: 1 })).rejects.toThrow(
      /permission/i,
    );
    await expect(
      setPrice(principal, storeA, productId, { mrpPaise: 1, sellingPricePaise: 1 }),
    ).rejects.toThrow(/permission/i);

    await destroyCustomerSession(token);
  });

  /**
   * The structural half of ADR-0010: the two credentials name rows in different
   * tables, so neither reader can be fooled by the other's token.
   */
  it('cannot read a customer token as a staff session, or the reverse', async () => {
    const { token: customerToken } = await createSessionForCustomer(customerId);
    // The staff reader does not know this token.
    expect(await readSession(customerToken)).toBeNull();

    const staffToken = (
      await prisma.session.create({
        data: {
          sessionToken: `staff-${suffix}`,
          userId: adminUserId,
          expires: new Date(Date.now() + 60_000),
        },
      })
    ).sessionToken;
    // …and the customer reader does not know the staff one.
    expect(await readCustomerSession(staffToken)).toBeNull();

    await prisma.session.deleteMany({ where: { sessionToken: staffToken } });
    await destroyCustomerSession(customerToken);
  });

  it('refuses a staff principal the account area', async () => {
    // A member of staff is not a customer, and the account area says so.
    await expect(getProfile(admin)).rejects.toThrow(/signed in/i);
    await expect(updateProfile(admin, { name: 'Nope' })).rejects.toThrow(/signed in/i);
    await expect(
      changePassword(admin, { currentPassword: 'x', newPassword: 'yyyyyyyy' }),
    ).rejects.toThrow(/signed in/i);
  });

  it('refuses a guest the account area too', async () => {
    const guest: Principal = { kind: 'customer', customerId: null, storeId: storeA };
    await expect(getProfile(guest)).rejects.toThrow(/signed in/i);
    await expect(updateProfile(guest, { name: 'Nope' })).rejects.toThrow(/signed in/i);
  });
});

describe('P3-6 — the profile is the session’s, never the form’s', () => {
  it('edits the signed-in shopper and nobody else', async () => {
    const principal: Principal = { kind: 'customer', customerId, storeId: storeA };
    await updateProfile(principal, { name: 'Renamed Shopper' });

    expect((await getProfile(principal)).name).toBe('Renamed Shopper');
    // The other account is untouched — there is no id to pass, by design.
    const other = await prisma.customer.findUniqueOrThrow({ where: { id: otherCustomerId } });
    expect(other.name).toBe('Another Shopper');
  });

  it('refuses a phone number another shopper already has', async () => {
    const principal: Principal = { kind: 'customer', customerId, storeId: storeA };
    const other = await prisma.customer.findUniqueOrThrow({ where: { id: otherCustomerId } });
    await expect(updateProfile(principal, { phone: other.phone })).rejects.toThrow(
      /already in use/i,
    );
  });

  it('changes a password only with the current one, and ends every session', async () => {
    const principal: Principal = { kind: 'customer', customerId, storeId: storeA };
    const first = await createSessionForCustomer(customerId);
    const second = await createSessionForCustomer(customerId);

    await expect(
      changePassword(principal, { currentPassword: 'WrongOne1', newPassword: 'BrandNewPass1' }),
    ).rejects.toThrow(/current password/i);

    await changePassword(principal, {
      currentPassword: PASSWORD,
      newPassword: 'BrandNewPass1',
    });

    // Both sessions are gone: the usual reason to change a password is that
    // somebody else might know the old one.
    expect(await readCustomerSession(first.token)).toBeNull();
    expect(await readCustomerSession(second.token)).toBeNull();

    expect(await verifyCustomerCredentials(emails.mine, PASSWORD)).toBeNull();
    await expect(verifyCustomerCredentials(emails.mine, 'BrandNewPass1')).resolves.toMatchObject({
      id: customerId,
    });

    // Put it back for any test that runs after this one.
    await changePassword(principal, {
      currentPassword: 'BrandNewPass1',
      newPassword: PASSWORD,
    });
  });
});

describe('P3-6 — the basket follows the shopper in', () => {
  it('binds the device’s basket to the customer on sign-in', async () => {
    const { cart } = await ensureCart(storeA, null);
    cartTokens.push(cart.cartToken);
    const guest: Principal = { kind: 'customer', customerId: null, storeId: storeA };
    await addItem(guest, {
      cartToken: cart.cartToken,
      storeId: storeA,
      productId,
      qty: 2,
    });

    await adoptCart(cart.cartToken, customerId);

    const adopted = await prisma.cart.findUniqueOrThrow({ where: { cartToken: cart.cartToken } });
    expect(adopted.customerId).toBe(customerId);
    // The items came with it.
    expect(await prisma.cartItem.count({ where: { cartId: adopted.id } })).toBe(1);
  });

  /**
   * The multi-cart rule: the device's basket wins, and the other is abandoned
   * rather than merged. Folding in items chosen on another device days ago
   * produces a basket the shopper did not assemble.
   */
  it('abandons a basket the customer had elsewhere, rather than merging it', async () => {
    const older = await ensureCart(storeA, null);
    cartTokens.push(older.cart.cartToken);
    await adoptCart(older.cart.cartToken, otherCustomerId);

    const newer = await ensureCart(storeA, null);
    cartTokens.push(newer.cart.cartToken);
    await adoptCart(newer.cart.cartToken, otherCustomerId);

    const rows = await prisma.cart.findMany({
      where: { cartToken: { in: [older.cart.cartToken, newer.cart.cartToken] } },
    });
    const byToken = new Map(rows.map((row) => [row.cartToken, row]));
    expect(byToken.get(newer.cart.cartToken)?.status).toBe('ACTIVE');
    expect(byToken.get(older.cart.cartToken)?.status).toBe('ABANDONED');
    // Abandoned, not deleted: nothing a support conversation could want is lost.
    expect(byToken.get(older.cart.cartToken)?.customerId).toBe(otherCustomerId);
  });

  it('is a no-op for a basket that is already the customer’s', async () => {
    const { cart } = await ensureCart(storeA, null);
    cartTokens.push(cart.cartToken);
    await adoptCart(cart.cartToken, customerId);
    await adoptCart(cart.cartToken, customerId);

    const row = await prisma.cart.findUniqueOrThrow({ where: { cartToken: cart.cartToken } });
    expect(row.status).toBe('ACTIVE');
    expect(row.customerId).toBe(customerId);
  });
});
