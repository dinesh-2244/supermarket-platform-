import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { addItem, ensureCart, removeItem, setQuantity, viewCart } from '@/modules/cart';
import { createCategory, createProduct, deactivateProduct } from '@/modules/catalog';
import { createUser } from '@/modules/identity';
import { adjustStock } from '@/modules/inventory';
import { setListed, setPrice } from '@/modules/pricing';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * P3-4 — the basket, and the promise it makes.
 *
 * Two things are on trial here. First, that **nothing is trusted from the
 * client**: a price that moved, a product that was delisted and a shelf that ran
 * short are all discovered on the next look, not carried over from the snapshot.
 * Second, and more important, that a basket **writes no stock and no order** —
 * asserted at the end against every table Phase 4 will own.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let admin: Principal;
let adminUserId: string;
let storeA: string;
let storeB: string;
let shopperA: Principal;
let categoryId: string;
let rice: string;
let dal: string;
const productIds: string[] = [];
const cartTokens: string[] = [];

async function makeProduct(name: string): Promise<string> {
  const product = await createProduct(admin, {
    sku: `CART-${suffix}-${productIds.length}`,
    name,
    packSize: '1 kg',
    categoryId,
  });
  productIds.push(product.id);
  return product.id;
}

/** List a product at a store and set an absolute balance, without the ledger. */
async function stockAt(storeId: string, productId: string, price: number, qty: number) {
  await setPrice(admin, storeId, productId, { mrpPaise: price + 500, sellingPricePaise: price });
  await prisma.inventoryItem.upsert({
    where: { storeId_productId: { storeId, productId } },
    update: { websiteStock: qty },
    create: { storeId, productId, websiteStock: qty },
  });
}

/** A fresh basket bound to store A, remembered for teardown. */
async function newCart(storeId = storeA): Promise<string> {
  const { cart } = await ensureCart(storeId, null);
  cartTokens.push(cart.cartToken);
  return cart.cartToken;
}

beforeAll(async () => {
  const bootstrap: Principal = {
    kind: 'user',
    userId: 'cart-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const adminRow = await createUser(bootstrap, {
    email: `cart-admin-${suffix}@example.test`,
    name: 'Cart Admin',
    password: 'CartAdminPass123',
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  adminUserId = adminRow.id;
  admin = { kind: 'user', userId: adminUserId, role: 'SUPER_ADMIN', storeId: null };

  const a = await createStore(prisma, { code: `CRA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `CRB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  await createStoreSettings(prisma, storeA, { deliveryFeePaise: 3_000, minOrderPaise: 20_000 });
  await createStoreSettings(prisma, storeB);
  shopperA = { kind: 'customer', customerId: null, storeId: storeA };

  categoryId = (await createCategory(admin, { name: `Cart ${suffix}` })).id;
  rice = await makeProduct(`Cart Rice ${suffix}`);
  dal = await makeProduct(`Cart Dal ${suffix}`);
});

beforeEach(async () => {
  // Every test starts from the same shelf, so a price or stock change made by
  // one is never a hidden precondition of the next.
  await stockAt(storeA, rice, 12_000, 50);
  await stockAt(storeA, dal, 9_000, 50);
  await setListed(admin, storeA, rice, true);
  await setListed(admin, storeA, dal, true);
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.cartItem.deleteMany({ where: { cart: { cartToken: { in: cartTokens } } } });
  await prisma.cart.deleteMany({ where: { cartToken: { in: cartTokens } } });
  await prisma.auditLog.deleteMany({
    where: { actorId: { in: [adminUserId, 'cart-bootstrap'] } },
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

describe('P3-4 — a basket belongs to one shop', () => {
  it('adds, tops up, re-quantifies and removes', async () => {
    const token = await newCart();

    let view = await addItem(shopperA, {
      cartToken: token,
      storeId: storeA,
      productId: rice,
      qty: 2,
    });
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]).toMatchObject({ qty: 2, unitPricePaise: 12_000, lineTotalPaise: 24_000 });

    // Pressing "add" again tops the line up rather than starting a second one.
    view = await addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty: 1 });
    expect(view.lines).toHaveLength(1);
    expect(view.lines[0]?.qty).toBe(3);

    view = await setQuantity(shopperA, { cartToken: token, productId: rice, qty: 5 });
    expect(view.lines[0]?.qty).toBe(5);
    expect(view.totals.subtotalPaise).toBe(60_000);

    view = await removeItem(shopperA, { cartToken: token, productId: rice });
    expect(view.lines).toHaveLength(0);
    expect(view.totals.subtotalPaise).toBe(0);
  });

  it('refuses a product from another shop, however the request is shaped', async () => {
    const onlyB = await makeProduct(`Only B ${suffix}`);
    await stockAt(storeB, onlyB, 5_000, 10);

    const token = await newCart();
    // The UI never offers it; the service must not trust that.
    await expect(
      addItem(shopperA, { cartToken: token, storeId: storeA, productId: onlyB, qty: 1 }),
    ).rejects.toThrow(/not available at your shop/i);
  });

  it('refuses a store id that is not the basket’s', async () => {
    const token = await newCart();
    await expect(
      addItem(shopperA, { cartToken: token, storeId: storeB, productId: rice, qty: 1 }),
    ).rejects.toThrow(/different shop/i);
  });

  it('cannot be reached with somebody else’s token', async () => {
    const mine = await newCart();
    await addItem(shopperA, { cartToken: mine, storeId: storeA, productId: rice, qty: 1 });

    const theirs = await newCart();
    // A different token is a different basket, not a view onto this one.
    expect((await viewCart(shopperA, theirs))?.lines).toHaveLength(0);
    expect(await viewCart(shopperA, 'c_NOT_A_REAL_TOKEN')).toBeNull();
  });

  it('refuses a quantity that is not a sensible whole number', async () => {
    const token = await newCart();
    for (const qty of [0, -1, 2.5, 1_000, Number.NaN]) {
      await expect(
        addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty }),
      ).rejects.toThrow(/quantity/i);
    }
  });
});

describe('P3-4 — the store is authoritative, on every look', () => {
  it('surfaces a price change and charges the new price', async () => {
    const token = await newCart();
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty: 2 });

    // The shop repricies while the tab sits open.
    await setPrice(admin, storeA, rice, { mrpPaise: 16_000, sellingPricePaise: 15_000 });

    const view = await viewCart(shopperA, token);
    const line = view?.lines[0];
    expect(line?.unitPricePaise).toBe(15_000);
    expect(line?.lineTotalPaise).toBe(30_000);
    expect(line?.issues).toContainEqual({
      kind: 'price-changed',
      oldPricePaise: 12_000,
      newPricePaise: 15_000,
    });

    // Told once: the snapshot is brought up to date, so a second look is quiet.
    const second = await viewCart(shopperA, token);
    expect(second?.lines[0]?.issues).toEqual([]);
    expect(second?.lines[0]?.unitPricePaise).toBe(15_000);
  });

  it('flags a shortfall without silently capping the quantity', async () => {
    const token = await newCart();
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty: 12 });

    await prisma.inventoryItem.update({
      where: { storeId_productId: { storeId: storeA, productId: rice } },
      data: { websiteStock: 8 },
    });

    const view = await viewCart(shopperA, token);
    // The shopper decides whether 8 is worth having — the basket does not.
    expect(view?.lines[0]?.qty).toBe(12);
    expect(view?.lines[0]?.issues).toContainEqual({ kind: 'insufficient-stock', available: 8 });
  });

  it('flags an empty shelf', async () => {
    const token = await newCart();
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty: 1 });

    await prisma.inventoryItem.update({
      where: { storeId_productId: { storeId: storeA, productId: rice } },
      data: { websiteStock: 0 },
    });

    const view = await viewCart(shopperA, token);
    expect(view?.lines[0]?.issues).toContainEqual({ kind: 'out-of-stock' });
    // Still in the basket, and still counted: it is the shopper's to remove.
    expect(view?.lines).toHaveLength(1);
    expect(view?.totals.subtotalPaise).toBe(12_000);
  });

  it('reports a price change and a shortfall on the same line', async () => {
    const token = await newCart();
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty: 10 });

    await setPrice(admin, storeA, rice, { mrpPaise: 12_500, sellingPricePaise: 11_000 });
    await prisma.inventoryItem.update({
      where: { storeId_productId: { storeId: storeA, productId: rice } },
      data: { websiteStock: 3 },
    });

    const issues = (await viewCart(shopperA, token))?.lines[0]?.issues ?? [];
    expect(issues.map((issue) => issue.kind).sort()).toEqual([
      'insufficient-stock',
      'price-changed',
    ]);
  });

  it('removes a line the store stops selling, and says why', async () => {
    const token = await newCart();
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty: 1 });
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: dal, qty: 1 });

    await setListed(admin, storeA, rice, false);

    const view = await viewCart(shopperA, token);
    expect(view?.lines.map((line) => line.productId)).toEqual([dal]);
    expect(view?.removed).toEqual([
      { productId: rice, name: `Cart Rice ${suffix}`, reason: 'unlisted' },
    ]);
    // Really gone from the row, not just from the view — in *this* basket.
    expect(
      await prisma.cartItem.count({ where: { productId: rice, cart: { cartToken: token } } }),
    ).toBe(0);
  });

  it('removes a line the catalogue discontinues', async () => {
    const doomed = await makeProduct(`Doomed ${suffix}`);
    await stockAt(storeA, doomed, 4_000, 10);

    const token = await newCart();
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: doomed, qty: 1 });
    await deactivateProduct(admin, doomed);

    const view = await viewCart(shopperA, token);
    expect(view?.lines).toHaveLength(0);
    expect(view?.removed[0]).toMatchObject({ productId: doomed, reason: 'discontinued' });
  });

  it('shows the store’s delivery fee and minimum, and whether it is met', async () => {
    const token = await newCart();
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty: 1 });

    let view = await viewCart(shopperA, token);
    expect(view?.totals).toMatchObject({
      deliveryFeePaise: 3_000,
      minOrderPaise: 20_000,
      subtotalPaise: 12_000,
      meetsMinimum: false,
    });

    await setQuantity(shopperA, { cartToken: token, productId: rice, qty: 2 });
    view = await viewCart(shopperA, token);
    // Displayed, never enforced — enforcement is checkout, which is Phase 4.
    expect(view?.totals.meetsMinimum).toBe(true);
  });
});

describe('P3-4 — a basket moves no stock and creates no order', () => {
  it('leaves every Phase 4 table exactly as it found it', async () => {
    const snapshot = async () => ({
      orders: await prisma.order.count(),
      lines: await prisma.orderLine.count(),
      history: await prisma.orderStatusHistory.count(),
      ledger: await prisma.stockLedger.count(),
      stock: await prisma.inventoryItem.findMany({
        where: { storeId: storeA },
        select: { productId: true, websiteStock: true },
        orderBy: { productId: 'asc' },
      }),
    });

    const before = await snapshot();
    const token = await newCart();

    // Every mutation the module has, plus a revalidation that removes a line.
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty: 3 });
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: dal, qty: 2 });
    await setQuantity(shopperA, { cartToken: token, productId: rice, qty: 7 });
    await setPrice(admin, storeA, rice, { mrpPaise: 14_000, sellingPricePaise: 13_000 });
    await prisma.inventoryItem.update({
      where: { storeId_productId: { storeId: storeA, productId: dal } },
      data: { websiteStock: 1 },
    });
    await viewCart(shopperA, token);
    await setListed(admin, storeA, dal, false);
    await viewCart(shopperA, token);
    await removeItem(shopperA, { cartToken: token, productId: rice });

    const after = await snapshot();
    // Not one row in anything Phase 4 will own.
    expect(after.orders).toBe(before.orders);
    expect(after.lines).toBe(before.lines);
    expect(after.history).toBe(before.history);
    expect(after.ledger).toBe(before.ledger);

    // Stock is exactly what it was, except for the single balance this *test*
    // wrote directly to provoke a shortfall. Spelling that one out is the point:
    // anything else moving would mean the basket moved it.
    const expected = before.stock.map((row) =>
      row.productId === dal ? { productId: dal, websiteStock: 1 } : row,
    );
    expect(after.stock).toEqual(expected);
  });

  it('does not reserve stock — two baskets may hold the last unit', async () => {
    const scarce = await makeProduct(`Scarce ${suffix}`);
    await stockAt(storeA, scarce, 6_000, 1);

    const mine = await newCart();
    const theirs = await newCart();
    await addItem(shopperA, { cartToken: mine, storeId: storeA, productId: scarce, qty: 1 });
    await addItem(shopperA, { cartToken: theirs, storeId: storeA, productId: scarce, qty: 1 });

    // Both baskets hold it, neither line is flagged, and the shelf still says 1.
    expect((await viewCart(shopperA, mine))?.lines[0]?.issues).toEqual([]);
    expect((await viewCart(shopperA, theirs))?.lines[0]?.issues).toEqual([]);
    const item = await prisma.inventoryItem.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA, productId: scarce } },
    });
    expect(item.websiteStock).toBe(1);
  });

  it('is unaffected by a real stock movement except in what it reports', async () => {
    const token = await newCart();
    await addItem(shopperA, { cartToken: token, storeId: storeA, productId: rice, qty: 4 });

    // A genuine admin adjustment — the one legitimate way stock moves.
    const before = await prisma.stockLedger.count({ where: { storeId: storeA } });
    await adjustStock(admin, { storeId: storeA, productId: rice, delta: -48 });
    const after = await prisma.stockLedger.count({ where: { storeId: storeA } });
    expect(after).toBe(before + 1);

    // The basket notices on the next look, and still writes no ledger row.
    const view = await viewCart(shopperA, token);
    expect(view?.lines[0]?.issues).toContainEqual({ kind: 'insufficient-stock', available: 2 });
    expect(await prisma.stockLedger.count({ where: { storeId: storeA } })).toBe(after);
  });
});
