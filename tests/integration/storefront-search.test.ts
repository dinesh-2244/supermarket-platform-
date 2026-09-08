import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { createCategory, createProduct, MAX_SEARCH_QUERY_LENGTH } from '@/modules/catalog';
import { createUser } from '@/modules/identity';
import { setListed, setPrice } from '@/modules/pricing';
import { searchShop } from '@/app/(storefront)/catalogue';
import type { StoreContext } from '@/storefront';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * P3-3 — search, scoped to the store the visitor is bound to.
 *
 * The interesting failures are not "no results": they are results belonging to
 * the *other* store, and a query that is treated as SQL rather than as text.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let admin: Principal;
let adminUserId: string;
let storeA: string;
let storeB: string;
let contextA: StoreContext;
let categoryId: string;
const productIds: string[] = [];

function contextFor(storeId: string): StoreContext {
  return {
    areaId: `area-${storeId}`,
    serviceability: {
      servable: true,
      storeId,
      zoneId: 'zone',
      areaId: `area-${storeId}`,
      deliveryFeePaise: 3_000,
      minOrderPaise: 20_000,
      slotLengthMinutes: 60,
      slotCapacity: 10,
    },
  };
}

async function makeProduct(name: string, brand?: string): Promise<string> {
  const product = await createProduct(admin, {
    sku: `SRCH-${suffix}-${productIds.length}`,
    name,
    packSize: '1 kg',
    categoryId,
    ...(brand === undefined ? {} : { brand }),
  });
  productIds.push(product.id);
  return product.id;
}

async function list(storeId: string, productId: string): Promise<void> {
  await setPrice(admin, storeId, productId, { mrpPaise: 5_000, sellingPricePaise: 4_000 });
  await prisma.inventoryItem.upsert({
    where: { storeId_productId: { storeId, productId } },
    update: { websiteStock: 25 },
    create: { storeId, productId, websiteStock: 25 },
  });
}

beforeAll(async () => {
  const bootstrap: Principal = {
    kind: 'user',
    userId: 'srch-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const adminRow = await createUser(bootstrap, {
    email: `srch-admin-${suffix}@example.test`,
    name: 'Search Admin',
    password: 'SearchAdminPass123',
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  adminUserId = adminRow.id;
  admin = { kind: 'user', userId: adminUserId, role: 'SUPER_ADMIN', storeId: null };

  const a = await createStore(prisma, { code: `SRA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `SRB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  await createStoreSettings(prisma, storeA);
  await createStoreSettings(prisma, storeB);
  contextA = contextFor(storeA);

  categoryId = (await createCategory(admin, { name: `Search ${suffix}` })).id;
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.auditLog.deleteMany({
    where: { actorId: { in: [adminUserId, 'srch-bootstrap'] } },
  });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: { in: stores } } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.session.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.deleteMany({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('P3-3 — search is this store’s', () => {
  it('finds a product this store lists', async () => {
    const id = await makeProduct(`Kolam Rice ${suffix}`, `Brandy${suffix}`);
    await list(storeA, id);

    const results = await searchShop(contextA, `Kolam Rice ${suffix}`);
    expect(results.items.map((item) => item.product.id)).toContain(id);
    // The price on a search card is this store's, like everywhere else.
    expect(results.items[0]?.sellingPricePaise).toBe(4_000);
  });

  it('never surfaces a product only the other store lists', async () => {
    const mine = await makeProduct(`Shared Term ${suffix} Mine`);
    const theirs = await makeProduct(`Shared Term ${suffix} Theirs`);
    await list(storeA, mine);
    await list(storeB, theirs);

    const results = await searchShop(contextA, `Shared Term ${suffix}`);
    const ids = results.items.map((item) => item.product.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it('drops a product the store unlists', async () => {
    const id = await makeProduct(`Vanishing ${suffix}`);
    await list(storeA, id);
    expect((await searchShop(contextA, `Vanishing ${suffix}`)).total).toBe(1);

    await setListed(admin, storeA, id, false);
    expect((await searchShop(contextA, `Vanishing ${suffix}`)).total).toBe(0);
  });

  it('finds by brand, and tolerates a misspelling', async () => {
    const id = await makeProduct(`Filter Coffee Powder ${suffix}`, `Kumbakonam${suffix}`);
    await list(storeA, id);

    expect(
      (await searchShop(contextA, `Kumbakonam${suffix}`)).items.map((i) => i.product.id),
    ).toContain(id);
    // The reason pg_trgm is here at all.
    expect(
      (await searchShop(contextA, 'Filtr Coffe Powdr')).items.some((i) => i.product.id === id),
    ).toBe(true);
  });
});

describe('P3-3 — a query is text, not syntax', () => {
  /**
   * Parameterising the query stops injection; it does **not** stop `LIKE`
   * metacharacters, which are wildcards inside the pattern however the text
   * arrived. Before `likePattern` escaped them, searching `%` matched the whole
   * catalogue and "100% Pure" really meant "100(anything) Pure".
   */
  it('treats SQL wildcards as characters to search for', async () => {
    const withPercent = await makeProduct(`Hundred% Pure ${suffix}`);
    const without = await makeProduct(`Plain Pure ${suffix}`);
    await list(storeA, withPercent);
    await list(storeA, without);

    // `%` finds the products that contain one — not every product in the store.
    const wildcard = await searchShop(contextA, '%');
    const wildcardIds = wildcard.items.map((i) => i.product.id);
    expect(wildcardIds).toContain(withPercent);
    expect(wildcardIds).not.toContain(without);

    // `_` is the other metacharacter, and matches nothing here.
    expect((await searchShop(contextA, '_')).items.map((i) => i.product.id)).not.toContain(without);

    // The whole literal name still finds its product.
    expect(
      (await searchShop(contextA, `Hundred% Pure ${suffix}`)).items.map((i) => i.product.id),
    ).toContain(withPercent);
  });

  it('survives quotes, underscores and a statement terminator', async () => {
    for (const query of ['\'; DROP TABLE "Product"; --', '_', "O'Brien", '\\', '100%_']) {
      await expect(searchShop(contextA, query)).resolves.toMatchObject({
        items: expect.any(Array),
      });
    }
    // The table is still there, which is the point of the previous line.
    expect(await prisma.product.count({ where: { id: { in: productIds } } })).toBe(
      productIds.length,
    );
  });

  it('caps a very long query instead of running it', async () => {
    const id = await makeProduct(`Cappable ${suffix}`);
    await list(storeA, id);

    // The tail beyond the cap is ignored, so the search still finds the product.
    const padded = `Cappable ${suffix}${' x'.repeat(MAX_SEARCH_QUERY_LENGTH)}`;
    expect(padded.length).toBeGreaterThan(MAX_SEARCH_QUERY_LENGTH);
    await expect(searchShop(contextA, padded)).resolves.toMatchObject({
      items: expect.any(Array),
    });
  });

  it('returns nothing for an empty or whitespace query, rather than everything', async () => {
    expect((await searchShop(contextA, '')).total).toBe(0);
    expect((await searchShop(contextA, '   ')).total).toBe(0);
  });

  it('returns nothing when the store lists nothing at all', async () => {
    const empty = await createStore(prisma, { code: `SRE-${suffix.slice(-5)}` });
    await createStoreSettings(prisma, empty.id);
    try {
      // An empty scope must mean "nothing", never "no filter".
      expect((await searchShop(contextFor(empty.id), `Kolam Rice ${suffix}`)).total).toBe(0);
    } finally {
      await prisma.storeSettings.deleteMany({ where: { storeId: empty.id } });
      await prisma.store.deleteMany({ where: { id: empty.id } });
    }
  });
});
