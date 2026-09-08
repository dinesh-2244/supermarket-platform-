import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { createCategory, createProduct, deactivateProduct } from '@/modules/catalog';
import { availabilityFor, LOW_STOCK_DISPLAY_THRESHOLD } from '@/modules/inventory';
import { setListed, setPrice } from '@/modules/pricing';
import { createUser } from '@/modules/identity';
import { productPage, shopCategories, shopPage } from '@/app/(storefront)/catalogue';
import type { StoreContext } from '@/storefront';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * P3-2 — the shop window: what one store shows, at whose prices, in what state.
 *
 * The defects worth guarding here all look the same from the outside — a
 * product appears — and differ entirely in whose it is: another store's listing,
 * a deactivated product, an unlisted one. Each gets its own case.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

// `PriceChange.actorUserId` is a real foreign key, so the admin has to be a
// real row — a bare principal object is enough for authz and not for the FK.
let admin: Principal;
let adminUserId: string;

let storeA: string;
let storeB: string;
let contextA: StoreContext;
let contextB: StoreContext;
let staples: string;
let rice: string;
let frozen: string;
const productIds: string[] = [];

/** A context standing in for the cookie, resolved exactly as a request would. */
function contextFor(storeId: string, areaId: string): StoreContext {
  return {
    areaId,
    serviceability: {
      servable: true,
      storeId,
      zoneId: 'zone',
      areaId,
      deliveryFeePaise: 3_000,
      minOrderPaise: 20_000,
      slotLengthMinutes: 60,
      slotCapacity: 10,
    },
  };
}

async function makeProduct(name: string, categoryId: string): Promise<string> {
  const product = await createProduct(admin, {
    sku: `SFC-${suffix}-${productIds.length}`,
    name,
    packSize: '1 kg',
    categoryId,
  });
  productIds.push(product.id);
  return product.id;
}

/** List a product in a store at a price, and give it a stock balance. */
async function stock(storeId: string, productId: string, price: number, qty: number) {
  await setPrice(admin, storeId, productId, { mrpPaise: price + 1_000, sellingPricePaise: price });
  await prisma.inventoryItem.upsert({
    where: { storeId_productId: { storeId, productId } },
    update: { websiteStock: qty },
    create: { storeId, productId, websiteStock: qty },
  });
}

beforeAll(async () => {
  const bootstrap: Principal = {
    kind: 'user',
    userId: 'sfc-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const adminRow = await createUser(bootstrap, {
    email: `sfc-admin-${suffix}@example.test`,
    name: 'Catalogue Admin',
    password: 'CataloguePass123',
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  adminUserId = adminRow.id;
  admin = { kind: 'user', userId: adminUserId, role: 'SUPER_ADMIN', storeId: null };

  const a = await createStore(prisma, { code: `SCA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `SCB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  await createStoreSettings(prisma, storeA);
  await createStoreSettings(prisma, storeB);
  contextA = contextFor(storeA, `area-${suffix}-a`);
  contextB = contextFor(storeB, `area-${suffix}-b`);

  staples = (await createCategory(admin, { name: `Staples ${suffix}` })).id;
  rice = (await createCategory(admin, { name: `Rice ${suffix}`, parentId: staples })).id;
  frozen = (await createCategory(admin, { name: `Frozen ${suffix}` })).id;
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.auditLog.deleteMany({
    where: { actorId: { in: [adminUserId, 'sfc-bootstrap'] } },
  });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: { in: stores } } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.productImage.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: { in: [rice, staples, frozen] } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.session.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.deleteMany({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('P3-2 — the shop window is one store’s', () => {
  it('shows only what this store lists, at this store’s price', async () => {
    const shared = await makeProduct(`Shared Rice ${suffix}`, rice);
    const onlyB = await makeProduct(`Only At B ${suffix}`, rice);

    await stock(storeA, shared, 12_000, 40);
    await stock(storeB, shared, 13_500, 40);
    await stock(storeB, onlyB, 9_900, 40);

    const page = await shopPage(contextA);
    const ids = page.items.map((item) => item.product.id);

    expect(ids).toContain(shared);
    // The other store's exclusive product is not merely priced differently here
    // — it is absent.
    expect(ids).not.toContain(onlyB);

    const item = page.items.find((row) => row.product.id === shared);
    expect(item?.sellingPricePaise).toBe(12_000);

    // …and the same product on the other store's page carries its price.
    const otherPage = await shopPage(contextB);
    expect(otherPage.items.find((row) => row.product.id === shared)?.sellingPricePaise).toBe(
      13_500,
    );
  });

  it('drops a product the store unlists, without touching the master', async () => {
    const product = await makeProduct(`Delisted ${suffix}`, rice);
    await stock(storeA, product, 5_000, 10);

    expect((await shopPage(contextA)).items.map((i) => i.product.id)).toContain(product);

    await setListed(admin, storeA, product, false);

    expect((await shopPage(contextA)).items.map((i) => i.product.id)).not.toContain(product);
    // The master row is untouched — this is one store's decision (ADR-0003).
    expect(await prisma.product.count({ where: { id: product, isActive: true } })).toBe(1);
  });

  it('drops a product the catalogue deactivates', async () => {
    const product = await makeProduct(`Discontinued ${suffix}`, rice);
    await stock(storeA, product, 4_000, 10);
    await deactivateProduct(admin, product);

    expect((await shopPage(contextA)).items.map((i) => i.product.id)).not.toContain(product);
  });

  it('includes a subtree, not just the exact category', async () => {
    const inRice = await makeProduct(`Subtree Rice ${suffix}`, rice);
    await stock(storeA, inRice, 8_000, 20);

    // Filed under Staples > Rice, but browsing Staples must find it.
    const page = await shopPage(contextA, { categoryId: staples });
    expect(page.items.map((i) => i.product.id)).toContain(inRice);
  });

  it('offers only aisles this store has something in', async () => {
    const categories = await shopCategories(contextA);
    const names = categories.map((category) => category.name);
    expect(names).toContain(`Staples ${suffix}`);
    // Nothing was ever listed in Frozen at this store.
    expect(names).not.toContain(`Frozen ${suffix}`);
  });
});

describe('P3-2 — availability is a band, not a number', () => {
  it('reports in stock, only-N-left and out of stock', async () => {
    const plenty = await makeProduct(`Plenty ${suffix}`, rice);
    const scarce = await makeProduct(`Scarce ${suffix}`, rice);
    const gone = await makeProduct(`Gone ${suffix}`, rice);

    await stock(storeA, plenty, 1_000, 50);
    await stock(storeA, scarce, 1_000, LOW_STOCK_DISPLAY_THRESHOLD - 1);
    await stock(storeA, gone, 1_000, 0);

    const page = await shopPage(contextA);
    const byId = new Map(page.items.map((item) => [item.product.id, item.availability]));

    // A healthy shelf publishes no number at all.
    expect(byId.get(plenty)).toMatchObject({ availability: 'IN_STOCK', remaining: null });
    expect(byId.get(scarce)).toMatchObject({
      availability: 'LOW',
      remaining: LOW_STOCK_DISPLAY_THRESHOLD - 1,
    });
    expect(byId.get(gone)).toMatchObject({ availability: 'OUT_OF_STOCK', remaining: 0 });
  });

  it('treats a never-stocked product as out of stock, not as missing', async () => {
    const product = await makeProduct(`Never Stocked ${suffix}`, rice);
    await setPrice(admin, storeA, product, { mrpPaise: 2_000, sellingPricePaise: 1_500 });

    const bands = await availabilityFor(
      { kind: 'customer', customerId: null, storeId: storeA },
      storeA,
      [product],
    );
    expect(bands.get(product)).toMatchObject({ availability: 'OUT_OF_STOCK' });

    const page = await shopPage(contextA);
    const item = page.items.find((row) => row.product.id === product);
    expect(item?.availability.availability).toBe('OUT_OF_STOCK');
  });
});

describe('P3-2 — the product page', () => {
  it('resolves a global slug against this store’s terms', async () => {
    const product = await makeProduct(`Sluggish ${suffix}`, rice);
    await stock(storeA, product, 7_700, 30);
    await stock(storeB, product, 8_800, 30);

    const row = await prisma.product.findUniqueOrThrow({ where: { id: product } });

    expect(await productPage(contextA, row.slug)).toMatchObject({ sellingPricePaise: 7_700 });
    expect(await productPage(contextB, row.slug)).toMatchObject({ sellingPricePaise: 8_800 });
  });

  it('is a 404 for a product this store does not list — the same as for no slug', async () => {
    const product = await makeProduct(`Elsewhere ${suffix}`, rice);
    await stock(storeB, product, 6_000, 5);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: product } });

    // Identical answers, so the page cannot leak what the other store sells.
    expect(await productPage(contextA, row.slug)).toBeNull();
    expect(await productPage(contextA, `no-such-slug-${suffix}`)).toBeNull();
  });

  it('carries a breadcrumb from the root down', async () => {
    const product = await makeProduct(`Breadcrumbed ${suffix}`, rice);
    await stock(storeA, product, 3_300, 9);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: product } });

    const page = await productPage(contextA, row.slug);
    expect(page?.trail.map((category) => category.name)).toEqual([
      `Staples ${suffix}`,
      `Rice ${suffix}`,
    ]);
  });
});

describe('P3-2 — browsing writes nothing', () => {
  it('leaves stock, the ledger and orders untouched', async () => {
    const before = {
      ledger: await prisma.stockLedger.count(),
      orders: await prisma.order.count(),
      lines: await prisma.orderLine.count(),
      history: await prisma.orderStatusHistory.count(),
      stock: await prisma.inventoryItem.findMany({
        where: { storeId: storeA },
        select: { productId: true, websiteStock: true },
        orderBy: { productId: 'asc' },
      }),
    };

    await shopPage(contextA);
    await shopPage(contextA, { categoryId: staples });
    await shopCategories(contextA);
    const row = await prisma.product.findFirstOrThrow({ where: { id: { in: productIds } } });
    await productPage(contextA, row.slug);

    expect(await prisma.stockLedger.count()).toBe(before.ledger);
    expect(await prisma.order.count()).toBe(before.orders);
    expect(await prisma.orderLine.count()).toBe(before.lines);
    expect(await prisma.orderStatusHistory.count()).toBe(before.history);
    expect(
      await prisma.inventoryItem.findMany({
        where: { storeId: storeA },
        select: { productId: true, websiteStock: true },
        orderBy: { productId: 'asc' },
      }),
    ).toEqual(before.stock);
  });
});
