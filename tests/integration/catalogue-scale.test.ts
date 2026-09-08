import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { createCategory } from '@/modules/catalog';
import { createUser } from '@/modules/identity';
import { addItem, ensureCart, viewCart } from '@/modules/cart';
import { productPage, searchShop, shopPage } from '@/app/(storefront)/catalogue';
import type { StoreContext } from '@/storefront';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * R6 — a store with more listings than any one query returns.
 *
 * The original code read "the store's listings" as `listListings(..., limit:
 * 500)` and then searched the result in memory. That answers *is this product in
 * the first 500 listings?*, which is a different question with the same shape:
 * past the 500th listing a product the store really sells reads as unlisted, and
 * the basket **deletes the line** for it. Nothing about the failure is visible
 * from a small catalogue, which is why it survived a green suite.
 *
 * The fixture is therefore deliberately over the old limit and — because ids are
 * explicit here — the product under test is guaranteed to sort *last*, so this
 * file fails deterministically against the old code rather than one time in six.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

/** Comfortably past the old `take: 500`. */
const FILLER_COUNT = 520;

let admin: Principal;
let adminUserId: string;
let storeId: string;
let categoryId: string;
let context: StoreContext;
/** The product whose id sorts after every filler, so it fell off the end. */
let tailProductId: string;
const tailSlug = `r6-tail-product-${suffix}`;
const tailName = `Zenith Tail Rice ${suffix}`;
const cartTokens: string[] = [];

function contextFor(store: string): StoreContext {
  return {
    areaId: 'area',
    serviceability: {
      servable: true,
      storeId: store,
      zoneId: 'zone',
      areaId: 'area',
      deliveryFeePaise: 3_000,
      minOrderPaise: 20_000,
      slotLengthMinutes: 60,
      slotCapacity: 10,
    },
  };
}

beforeAll(async () => {
  const bootstrap: Principal = {
    kind: 'user',
    userId: 'r6-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const adminRow = await createUser(bootstrap, {
    email: `r6-admin-${suffix}@example.test`,
    name: 'Scale Admin',
    password: 'ScaleAdminPass123',
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  adminUserId = adminRow.id;
  admin = { kind: 'user', userId: adminUserId, role: 'SUPER_ADMIN', storeId: null };

  const store = await createStore(prisma, { code: `R6-${suffix.slice(-5)}` });
  storeId = store.id;
  await createStoreSettings(prisma, storeId, { deliveryFeePaise: 3_000, minOrderPaise: 20_000 });
  context = contextFor(storeId);
  categoryId = (await createCategory(admin, { name: `Scale ${suffix}` })).id;

  // Explicit ids: `a…` for every filler, `z…` for the product under test, so the
  // ordering the old `take` truncated is fixed rather than left to uuid luck.
  const fillers = Array.from({ length: FILLER_COUNT }, (_, index) => {
    const ordinal = String(index).padStart(4, '0');
    return {
      id: `r6a-${suffix}-${ordinal}`,
      sku: `R6F-${suffix}-${ordinal}`,
      name: `Filler ${ordinal} ${suffix}`,
      slug: `r6-filler-${suffix}-${ordinal}`,
      packSize: '1 kg',
      categoryId,
      aisleSortKey: 100,
    };
  });
  tailProductId = `r6z-${suffix}-tail`;

  await prisma.product.createMany({
    data: [
      ...fillers,
      {
        id: tailProductId,
        sku: `R6T-${suffix}`,
        name: tailName,
        slug: tailSlug,
        packSize: '5 kg',
        categoryId,
        aisleSortKey: 1,
      },
    ],
  });

  // Listings and stock written directly: `setPrice` writes a PriceChange and an
  // audit row per call, and 521 of each would make this file a minute long
  // without testing anything it does not already cover elsewhere.
  await prisma.storeProduct.createMany({
    data: [...fillers, { id: tailProductId }].map((product) => ({
      storeId,
      productId: product.id,
      isListed: true,
      mrpPaise: 12_000,
      sellingPricePaise: 10_000,
      listedAt: new Date(),
    })),
  });
  await prisma.inventoryItem.createMany({
    data: [...fillers, { id: tailProductId }].map((product) => ({
      storeId,
      productId: product.id,
      websiteStock: 10,
    })),
  });
});

afterAll(async () => {
  await prisma.cartItem.deleteMany({ where: { cart: { cartToken: { in: cartTokens } } } });
  await prisma.cart.deleteMany({ where: { cartToken: { in: cartTokens } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId } });
  await prisma.storeProduct.deleteMany({ where: { storeId } });
  await prisma.product.deleteMany({ where: { categoryId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminUserId, 'r6-bootstrap'] } } });
  await prisma.session.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.deleteMany({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('R6 — a listing past the 500th is still a listing', () => {
  it('sells it: the basket keeps the line instead of deleting it as unlisted', async () => {
    const shopper: Principal = { kind: 'customer', customerId: null, storeId };
    const { cart } = await ensureCart(storeId, null);
    cartTokens.push(cart.cartToken);

    const added = await addItem(shopper, {
      cartToken: cart.cartToken,
      storeId,
      productId: tailProductId,
      qty: 2,
    });
    expect(added.lines.map((line) => line.productId)).toEqual([tailProductId]);

    // The line has to survive a *second* revalidation too: the add path and the
    // view path looked the listing up separately, and both were truncated.
    const viewed = await viewCart(shopper, cart.cartToken);
    expect(viewed?.removed).toEqual([]);
    expect(viewed?.lines).toHaveLength(1);
    expect(viewed?.lines[0]).toMatchObject({ productId: tailProductId, qty: 2 });

    // …and the row is really still there, not merely reported as present.
    const row = await prisma.cartItem.findFirst({
      where: { cart: { cartToken: cart.cartToken }, productId: tailProductId },
    });
    expect(row).not.toBeNull();
  });

  it('shows it on its own product page', async () => {
    const page = await productPage(context, tailSlug);
    expect(page?.product.id).toBe(tailProductId);
    expect(page?.sellingPricePaise).toBe(10_000);
  });

  it('browses it, at a price, on the first page of the shop', async () => {
    // `aisleSortKey: 1` puts it first in shelf order, which is the ordering
    // browse uses — so a complete listing set means page one, every time.
    const page = await shopPage(context, {});
    expect(page.total).toBe(FILLER_COUNT + 1);
    expect(page.items[0]?.product.id).toBe(tailProductId);
    expect(page.items[0]?.sellingPricePaise).toBe(10_000);
  });

  it('finds it by search', async () => {
    const results = await searchShop(context, 'Zenith Tail');
    expect(results.items.map((item) => item.product.id)).toContain(tailProductId);
  });

  it('prices every product on a browse page, not just the ones near the front', async () => {
    // Prices are now fetched for the page's ids rather than wholesale, so the
    // regression this guards is the opposite one: a page item with no price is
    // silently dropped by `toShopItem`, which would look like a short page.
    const page = await shopPage(context, { page: 2 });
    expect(page.items).toHaveLength(24);
    expect(page.items.every((item) => item.sellingPricePaise > 0)).toBe(true);
  });
});
