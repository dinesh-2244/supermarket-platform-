import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { addItem, ensureCart, rebuildForStore, viewCart } from '@/modules/cart';
import { createCategory, createProduct } from '@/modules/catalog';
import { createUser } from '@/modules/identity';
import { setListed, setPrice } from '@/modules/pricing';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * P3-5 — the basket follows the shopper to another shop.
 *
 * A rebuild **replaces**, it does not merge: the new store's prices, listings
 * and stock are a different set of facts, and a merged basket would carry the
 * old shop's prices for products the new one sells at its own.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let admin: Principal;
let adminUserId: string;
let storeA: string;
let storeB: string;
let shopperA: Principal;
let shopperB: Principal;
let categoryId: string;
/** Sold by both shops, at different prices. */
let shared: string;
/** Sold only by A. */
let onlyA: string;
/** Listed by both, but B has none on the shelf. */
let emptyAtB: string;
const productIds: string[] = [];
const cartTokens: string[] = [];

async function makeProduct(name: string): Promise<string> {
  const product = await createProduct(admin, {
    sku: `RBLD-${suffix}-${productIds.length}`,
    name,
    packSize: '1 kg',
    categoryId,
  });
  productIds.push(product.id);
  return product.id;
}

async function stockAt(storeId: string, productId: string, price: number, qty: number) {
  await setPrice(admin, storeId, productId, { mrpPaise: price + 500, sellingPricePaise: price });
  await prisma.inventoryItem.upsert({
    where: { storeId_productId: { storeId, productId } },
    update: { websiteStock: qty },
    create: { storeId, productId, websiteStock: qty },
  });
}

async function newCart(storeId: string): Promise<string> {
  const { cart } = await ensureCart(storeId, null);
  cartTokens.push(cart.cartToken);
  return cart.cartToken;
}

beforeAll(async () => {
  const bootstrap: Principal = {
    kind: 'user',
    userId: 'rbld-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const adminRow = await createUser(bootstrap, {
    email: `rbld-admin-${suffix}@example.test`,
    name: 'Rebuild Admin',
    password: 'RebuildAdminPass123',
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  adminUserId = adminRow.id;
  admin = { kind: 'user', userId: adminUserId, role: 'SUPER_ADMIN', storeId: null };

  const a = await createStore(prisma, { code: `RBA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `RBB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  await createStoreSettings(prisma, storeA, { deliveryFeePaise: 3_000, minOrderPaise: 20_000 });
  await createStoreSettings(prisma, storeB, { deliveryFeePaise: 4_000, minOrderPaise: 25_000 });
  shopperA = { kind: 'customer', customerId: null, storeId: storeA };
  shopperB = { kind: 'customer', customerId: null, storeId: storeB };

  categoryId = (await createCategory(admin, { name: `Rebuild ${suffix}` })).id;
  shared = await makeProduct(`Shared ${suffix}`);
  onlyA = await makeProduct(`Only A ${suffix}`);
  emptyAtB = await makeProduct(`Empty At B ${suffix}`);
});

beforeEach(async () => {
  await stockAt(storeA, shared, 10_000, 20);
  await stockAt(storeA, onlyA, 5_000, 20);
  await stockAt(storeA, emptyAtB, 7_000, 20);

  await stockAt(storeB, shared, 12_000, 20);
  await stockAt(storeB, emptyAtB, 7_500, 0);
  await setListed(admin, storeB, shared, true);
  await setListed(admin, storeB, emptyAtB, true);
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.cartItem.deleteMany({ where: { cart: { cartToken: { in: cartTokens } } } });
  await prisma.cart.deleteMany({ where: { cartToken: { in: cartTokens } } });
  await prisma.auditLog.deleteMany({
    where: { actorId: { in: [adminUserId, 'rbld-bootstrap'] } },
  });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: { in: stores } } } });
  await prisma.stockLedger.deleteMany({ where: { storeId: { in: stores } } });
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

describe('P3-5 — switching to an area served by the other shop', () => {
  it('carries what the new shop sells, at the new shop’s price', async () => {
    const token = await newCart(storeA);
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: shared, qty: 2 });

    const outcome = await rebuildForStore(shopperB, token, storeB);

    expect(outcome.carried).toEqual([`Shared ${suffix}`]);
    expect(outcome.dropped).toEqual([]);

    const line = outcome.view.lines[0];
    expect(line).toMatchObject({ productId: shared, qty: 2, unitPricePaise: 12_000 });
    // Re-priced, so no "the price changed" notice: this is a move, not a drift.
    expect(line?.issues).toEqual([]);
    // The snapshot really was rewritten, not merely displayed differently.
    const item = await prisma.cartItem.findFirstOrThrow({
      where: { cart: { cartToken: token }, productId: shared },
    });
    expect(item.unitPriceSnapshotPaise).toBe(12_000);
  });

  it('drops what the new shop does not sell, and names it', async () => {
    const token = await newCart(storeA);
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: shared, qty: 1 });
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: onlyA, qty: 1 });

    const outcome = await rebuildForStore(shopperB, token, storeB);

    expect(outcome.carried).toEqual([`Shared ${suffix}`]);
    expect(outcome.dropped).toEqual([`Only A ${suffix}`]);
    expect(outcome.view.lines.map((line) => line.productId)).toEqual([shared]);
  });

  it('drops a product the new shop lists but has none of', async () => {
    const token = await newCart(storeA);
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: emptyAtB, qty: 1 });

    const outcome = await rebuildForStore(shopperB, token, storeB);

    // Listed there, but nothing on the shelf: carrying it over would put an
    // unbuyable line in a basket the shopper did not choose to keep.
    expect(outcome.carried).toEqual([]);
    expect(outcome.dropped).toEqual([`Empty At B ${suffix}`]);
    expect(outcome.view.lines).toHaveLength(0);
  });

  it('moves the cart itself, and replaces rather than merges its lines', async () => {
    const token = await newCart(storeA);
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: shared, qty: 3 });
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: onlyA, qty: 1 });

    await rebuildForStore(shopperB, token, storeB);

    const cart = await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } });
    expect(cart.storeId).toBe(storeB);

    // Exactly one line — the dropped one is gone from the table, not merged in.
    const items = await prisma.cartItem.findMany({ where: { cartId: cart.id } });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ productId: shared, qty: 3 });
  });

  it('shows the new shop’s delivery fee and minimum', async () => {
    const token = await newCart(storeA);
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: shared, qty: 1 });

    const outcome = await rebuildForStore(shopperB, token, storeB);
    expect(outcome.view.totals).toMatchObject({
      deliveryFeePaise: 4_000,
      minOrderPaise: 25_000,
    });
  });
});

describe('P3-5 — switching within the same shop', () => {
  it('leaves the basket alone', async () => {
    const token = await newCart(storeA);
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: shared, qty: 2 });
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: onlyA, qty: 1 });

    const outcome = await rebuildForStore(shopperA, token, storeA);

    expect(outcome.carried).toEqual([]);
    expect(outcome.dropped).toEqual([]);
    expect(outcome.view.lines.map((line) => line.productId).sort()).toEqual([shared, onlyA].sort());
  });

  it('still revalidates — a price may have moved for unrelated reasons', async () => {
    const token = await newCart(storeA);
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: shared, qty: 1 });

    await setPrice(admin, storeA, shared, { mrpPaise: 12_000, sellingPricePaise: 11_000 });

    const outcome = await rebuildForStore(shopperA, token, storeA);
    expect(outcome.view.lines[0]?.unitPricePaise).toBe(11_000);
    expect(outcome.view.lines[0]?.issues).toContainEqual({
      kind: 'price-changed',
      oldPricePaise: 10_000,
      newPricePaise: 11_000,
    });
  });
});

describe('P3-5 — a rebuild is still a basket, so it writes no stock', () => {
  it('leaves both shops’ stock, the ledger and orders untouched', async () => {
    const snapshot = async () => ({
      orders: await prisma.order.count(),
      ledger: await prisma.stockLedger.count(),
      stock: await prisma.inventoryItem.findMany({
        where: { storeId: { in: [storeA, storeB] } },
        select: { storeId: true, productId: true, websiteStock: true },
        orderBy: [{ storeId: 'asc' }, { productId: 'asc' }],
      }),
    });

    const token = await newCart(storeA);
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: shared, qty: 4 });
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: onlyA, qty: 2 });

    const before = await snapshot();
    await rebuildForStore(shopperB, token, storeB);
    await rebuildForStore(shopperA, token, storeA);
    await viewCart(shopperA, token);

    expect(await snapshot()).toEqual(before);
  });

  /**
   * D5's out-of-zone case: the context goes, the basket stays. Nothing here
   * *deletes* a cart, so a shopper who moves out of every zone and back finds
   * what they left — inert in between, because no page will render without a
   * store context.
   */
  it('keeps a basket that has no serviceable area to belong to', async () => {
    const token = await newCart(storeA);
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: shared, qty: 1 });

    // Losing the context is a cookie-level event; the row is not touched.
    const cart = await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } });
    expect(cart.status).toBe('ACTIVE');
    expect(await prisma.cartItem.count({ where: { cartId: cart.id } })).toBe(1);

    // …and it is still there, unchanged, when an area is chosen again.
    const view = await viewCart(shopperA, token);
    expect(view?.lines).toHaveLength(1);
  });
});
