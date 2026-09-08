import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { createCategory, createProduct } from '@/modules/catalog';
import { createUser } from '@/modules/identity';
import { getListing, listListings, listPriceHistory, setListed, setPrice } from '@/modules/pricing';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * P2-4 — per-store pricing and its append-only history.
 *
 * The point of every case here is that `PriceChange` is written in the *same
 * transaction* as the price, so no price can exist without the row explaining
 * how it got there — and that a manager cannot reach the other store's prices.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

/**
 * Real `User` rows, not invented ids: `PriceChange.actorUserId` carries a
 * foreign key to `User` (unlike `AuditLog.actorId`, which is a bare column), so
 * the actor recorded against a price move must actually exist. That is the right
 * constraint — a price history pointing at nobody explains nothing — and it
 * means these principals have to be real.
 */
let admin: Principal;
let managerA: Principal;
let managerB: Principal;
let staffA: Principal;
let storeA: string;
let storeB: string;
let productId: string;
let categoryId: string;
const userIds: string[] = [];

beforeAll(async () => {
  const a = await createStore(prisma, { code: `PRA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `PRB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  await createStoreSettings(prisma, storeA);
  await createStoreSettings(prisma, storeB);

  const bootstrap: Principal = {
    kind: 'user',
    userId: 'pr-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const password = 'PricingPassword123';
  const adminRow = await createUser(bootstrap, {
    email: `pr-admin-${suffix}@example.test`,
    name: 'Pricing Admin',
    password,
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  admin = { kind: 'user', userId: adminRow.id, role: 'SUPER_ADMIN', storeId: null };

  const mA = await createUser(admin, {
    email: `pr-mgr-a-${suffix}@example.test`,
    name: 'Pricing Manager A',
    password,
    role: 'STORE_MANAGER',
    storeId: storeA,
  });
  const mB = await createUser(admin, {
    email: `pr-mgr-b-${suffix}@example.test`,
    name: 'Pricing Manager B',
    password,
    role: 'STORE_MANAGER',
    storeId: storeB,
  });
  const sA = await createUser(admin, {
    email: `pr-stf-a-${suffix}@example.test`,
    name: 'Pricing Staff A',
    password,
    role: 'STORE_STAFF',
    storeId: storeA,
  });
  userIds.push(adminRow.id, mA.id, mB.id, sA.id);

  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
  staffA = { kind: 'user', userId: sA.id, role: 'STORE_STAFF', storeId: storeA };

  categoryId = (await createCategory(admin, { name: `Pricing ${suffix}` })).id;
  productId = (
    await createProduct(admin, {
      sku: `PRC-${suffix}`,
      name: `Priced Product ${suffix}`,
      packSize: '1 kg',
      categoryId,
    })
  ).id;
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [...userIds, 'pr-bootstrap'] } } });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: { in: stores } } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.$disconnect();
});

describe('pricing — every change writes exactly one PriceChange, in the same tx', () => {
  it('records the first price and each subsequent move', async () => {
    await setPrice(managerA, storeA, productId, { mrpPaise: 12_000, sellingPricePaise: 11_000 });
    await setPrice(managerA, storeA, productId, {
      mrpPaise: 12_000,
      sellingPricePaise: 10_500,
      reason: 'Weekend offer',
    });

    const listing = await getListing(managerA, storeA, productId);
    const history = await listPriceHistory(managerA, listing!.id);

    expect(history).toHaveLength(2);
    // Newest first.
    expect(history[0]).toMatchObject({
      oldSellingPricePaise: 11_000,
      newSellingPricePaise: 10_500,
      reason: 'Weekend offer',
      actorUserId: managerA.kind === 'user' ? managerA.userId : null,
    });
    expect(history[1]).toMatchObject({
      oldSellingPricePaise: 0,
      newSellingPricePaise: 11_000,
    });
  });

  // A history full of "changed from 120 to 120" is a history nobody reads.
  it('writes nothing for a no-op edit', async () => {
    const listing = await getListing(managerA, storeA, productId);
    const before = await listPriceHistory(managerA, listing!.id);

    await setPrice(managerA, storeA, productId, { mrpPaise: 12_000, sellingPricePaise: 10_500 });

    expect(await listPriceHistory(managerA, listing!.id)).toHaveLength(before.length);
  });

  it('leaves neither a price nor a history row when the price is invalid', async () => {
    const listing = await getListing(managerA, storeA, productId);
    const historyBefore = await listPriceHistory(managerA, listing!.id);

    await expect(
      setPrice(managerA, storeA, productId, { mrpPaise: 10_000, sellingPricePaise: 11_000 }),
    ).rejects.toThrow(/above MRP/i);

    const after = await getListing(managerA, storeA, productId);
    expect(after?.sellingPricePaise).toBe(10_500);
    expect(await listPriceHistory(managerA, listing!.id)).toHaveLength(historyBefore.length);
  });

  it('keeps the history append-only — nothing updates or deletes a row', async () => {
    const listing = await getListing(managerA, storeA, productId);
    const before = await listPriceHistory(managerA, listing!.id);
    const ids = before.map((row) => row.id);

    await setPrice(managerA, storeA, productId, { mrpPaise: 12_000, sellingPricePaise: 9_900 });

    const after = await listPriceHistory(managerA, listing!.id);
    // Every earlier row is still there, unchanged, with one appended.
    expect(after.map((row) => row.id)).toEqual(expect.arrayContaining(ids));
    expect(after).toHaveLength(before.length + 1);
  });

  it('writes an AuditLog row alongside the domain history', async () => {
    const listing = await getListing(managerA, storeA, productId);
    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'StoreProduct', entityId: listing!.id, action: 'set-price' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry.afterJson).toMatchObject({ sellingPricePaise: 9_900 });
  });
});

describe('pricing — independent per store', () => {
  it('lets each store price the same product differently', async () => {
    await setPrice(managerB, storeB, productId, { mrpPaise: 12_000, sellingPricePaise: 11_800 });

    const a = await getListing(admin, storeA, productId);
    const b = await getListing(admin, storeB, productId);

    expect(a?.sellingPricePaise).toBe(9_900);
    expect(b?.sellingPricePaise).toBe(11_800);
    // One shared master row behind both listings (ADR-0003).
    expect(a?.productId).toBe(b?.productId);
  });

  it('lists and unlists per store without touching the other', async () => {
    await setListed(managerA, storeA, productId, false);

    expect((await getListing(admin, storeA, productId))?.isListed).toBe(false);
    expect((await getListing(admin, storeB, productId))?.isListed).toBe(true);

    await setListed(managerA, storeA, productId, true);
    expect((await getListing(admin, storeA, productId))?.isListed).toBe(true);
  });
});

describe('pricing — cross-store denial (server-side)', () => {
  it('refuses a manager the other store’s price and listing', async () => {
    await expect(
      setPrice(managerA, storeB, productId, { mrpPaise: 12_000, sellingPricePaise: 1 }),
    ).rejects.toThrow(/permission/i);
    await expect(setListed(managerA, storeB, productId, false)).rejects.toThrow(/permission/i);
    await expect(getListing(managerA, storeB, productId)).rejects.toThrow(/permission/i);

    const listingB = await getListing(admin, storeB, productId);
    await expect(listPriceHistory(managerA, listingB!.id)).rejects.toThrow(/permission/i);

    // Unchanged by the attempts.
    expect((await getListing(admin, storeB, productId))?.sellingPricePaise).toBe(11_800);
  });

  it('shows a manager only their own store’s listings', async () => {
    const mine = await listListings(managerA);
    expect(mine.every((l) => l.storeId === storeA)).toBe(true);

    const all = await listListings(admin);
    expect(all.some((l) => l.storeId === storeB)).toBe(true);
  });

  it('lets staff read prices but never set them', async () => {
    await expect(listListings(staffA)).resolves.toBeInstanceOf(Array);
    await expect(
      setPrice(staffA, storeA, productId, { mrpPaise: 12_000, sellingPricePaise: 1_000 }),
    ).rejects.toThrow(/permission/i);
    await expect(setListed(staffA, storeA, productId, false)).rejects.toThrow(/permission/i);
  });
});

describe('pricing — referential integrity', () => {
  it('refuses to price a product that is not in the shared master', async () => {
    await expect(
      setPrice(admin, storeA, '00000000-0000-4000-8000-000000000000', {
        mrpPaise: 100,
        sellingPricePaise: 100,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses to price into a store that does not exist', async () => {
    await expect(
      setPrice(admin, '00000000-0000-4000-8000-000000000000', productId, {
        mrpPaise: 100,
        sellingPricePaise: 100,
      }),
    ).rejects.toThrow(/not found/i);
  });

  it('refuses to list a product with no price set yet', async () => {
    const other = await createProduct(admin, {
      sku: `UNPRICED-${suffix}`,
      name: `Unpriced ${suffix}`,
      packSize: '1 kg',
      categoryId,
    });
    await expect(setListed(admin, storeA, other.id, true)).rejects.toThrow(/set a price first/i);
    await prisma.product.delete({ where: { id: other.id } });
  });
});
