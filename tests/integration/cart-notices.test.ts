import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { addItem, ensureCart, removeItem, setQuantity, viewCart } from '@/modules/cart';
import { createCategory, createProduct } from '@/modules/catalog';
import { createUser } from '@/modules/identity';
import { setListed, setPrice } from '@/modules/pricing';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * R1 — a revalidation that nobody is told about.
 *
 * Every basket mutation revalidates, and revalidation is *consuming*: the
 * price-changed notice exists only because the stored snapshot still held the
 * old price, and updating that snapshot is what stops the notice repeating
 * forever. So the mutation is the one moment the notice exists. Three ways that
 * moment was thrown away — each of which leaves a shopper with a silently
 * re-priced or silently shortened basket, and none of which a returned-value
 * assertion on `viewCart` alone would catch.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let admin: Principal;
let adminUserId: string;
let storeId: string;
let shopper: Principal;
let categoryId: string;
let rice: string;
let dal: string;
const productIds: string[] = [];
const cartTokens: string[] = [];

async function makeProduct(name: string): Promise<string> {
  const product = await createProduct(admin, {
    sku: `CN-${suffix}-${productIds.length}`,
    name,
    packSize: '1 kg',
    categoryId,
  });
  productIds.push(product.id);
  return product.id;
}

async function priceAndStock(productId: string, price: number, qty: number): Promise<void> {
  // MRP stays clear of the selling price: `setPrice` refuses selling > MRP.
  await setPrice(admin, storeId, productId, { mrpPaise: 100_000, sellingPricePaise: price });
  await setListed(admin, storeId, productId, true);
  await prisma.inventoryItem.upsert({
    where: { storeId_productId: { storeId, productId } },
    update: { websiteStock: qty },
    create: { storeId, productId, websiteStock: qty },
  });
}

async function newCart(): Promise<string> {
  const { cart } = await ensureCart(storeId, null);
  cartTokens.push(cart.cartToken);
  return cart.cartToken;
}

beforeAll(async () => {
  const bootstrap: Principal = {
    kind: 'user',
    userId: 'cn-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const adminRow = await createUser(bootstrap, {
    email: `cn-admin-${suffix}@example.test`,
    name: 'Notice Admin',
    password: 'NoticeAdminPass123',
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  adminUserId = adminRow.id;
  admin = { kind: 'user', userId: adminUserId, role: 'SUPER_ADMIN', storeId: null };

  const store = await createStore(prisma, { code: `CN-${suffix.slice(-5)}` });
  storeId = store.id;
  await createStoreSettings(prisma, storeId, { deliveryFeePaise: 3_000, minOrderPaise: 20_000 });
  shopper = { kind: 'customer', customerId: null, storeId };

  categoryId = (await createCategory(admin, { name: `Notices ${suffix}` })).id;
  rice = await makeProduct(`Notice Rice ${suffix}`);
  dal = await makeProduct(`Notice Dal ${suffix}`);
});

beforeEach(async () => {
  await priceAndStock(rice, 10_000, 20);
  await priceAndStock(dal, 5_000, 20);
});

afterAll(async () => {
  await prisma.cartItem.deleteMany({ where: { cart: { cartToken: { in: cartTokens } } } });
  await prisma.cart.deleteMany({ where: { cartToken: { in: cartTokens } } });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId } } });
  await prisma.stockLedger.deleteMany({ where: { storeId } });
  await prisma.inventoryItem.deleteMany({ where: { storeId } });
  await prisma.storeProduct.deleteMany({ where: { storeId } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminUserId, 'cn-bootstrap'] } } });
  await prisma.session.deleteMany({ where: { userId: adminUserId } });
  await prisma.user.deleteMany({ where: { id: adminUserId } });
  await prisma.$disconnect();
});

describe('R1 — topping up a line does not swallow the price move', () => {
  it('reports the change against the price the shopper last saw', async () => {
    const token = await newCart();
    await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 1 });

    await setPrice(admin, storeId, rice, { mrpPaise: 100_000, sellingPricePaise: 30_000 });

    // Pressing "add" again on a line that already exists. The snapshot must
    // survive the write, or the revalidation that follows it compares today's
    // price against today's price and finds nothing to report.
    const view = await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 1 });

    expect(view.lines[0]).toMatchObject({ qty: 2, unitPricePaise: 30_000 });
    expect(view.lines[0]?.issues).toContainEqual({
      kind: 'price-changed',
      oldPricePaise: 10_000,
      newPricePaise: 30_000,
    });
  });

  it('says it exactly once, because the snapshot is then brought up to date', async () => {
    const token = await newCart();
    await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 1 });
    await setPrice(admin, storeId, rice, { mrpPaise: 100_000, sellingPricePaise: 30_000 });
    await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 1 });

    const again = await viewCart(shopper, token);
    expect(again?.lines[0]?.issues).toEqual([]);
  });

  it('still refuses to charge the old price', async () => {
    const token = await newCart();
    await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 2 });
    await setPrice(admin, storeId, rice, { mrpPaise: 100_000, sellingPricePaise: 30_000 });

    const view = await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 1 });
    // The notice is about telling the shopper, never about honouring a snapshot.
    expect(view.lines[0]?.lineTotalPaise).toBe(90_000);
    expect(view.totals.subtotalPaise).toBe(90_000);
  });
});

describe('R1 — a mutation returns what its own revalidation found', () => {
  it('hands a quantity change the price move it discovered', async () => {
    const token = await newCart();
    await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 1 });
    await setPrice(admin, storeId, rice, { mrpPaise: 100_000, sellingPricePaise: 20_000 });

    const view = await setQuantity(shopper, { cartToken: token, productId: rice, qty: 3 });
    expect(view.lines[0]?.issues).toContainEqual({
      kind: 'price-changed',
      oldPricePaise: 10_000,
      newPricePaise: 20_000,
    });

    // …and by the time the page re-reads the basket there is nothing left to
    // find, which is exactly why the action has to deliver what it was given.
    expect((await viewCart(shopper, token))?.lines[0]?.issues).toEqual([]);
  });

  it('hands a removal the delisting it discovered on a line being kept', async () => {
    const token = await newCart();
    await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 1 });
    await addItem(shopper, { cartToken: token, storeId, productId: dal, qty: 1 });
    await setListed(admin, storeId, dal, false);

    const view = await removeItem(shopper, { cartToken: token, productId: rice });
    expect(view.removed).toEqual([
      { productId: dal, name: `Notice Dal ${suffix}`, reason: 'unlisted' },
    ]);
    expect(view.lines).toHaveLength(0);
  });
});

describe('R1 — a basket emptied by a revalidation still says why', () => {
  it('reports the removal even though no line is left to hang it on', async () => {
    const token = await newCart();
    await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 1 });
    await setListed(admin, storeId, rice, false);

    const view = await viewCart(shopper, token);
    // "Your basket is empty" on its own is the one message that leaves a shopper
    // with no idea what happened to what they chose.
    expect(view?.lines).toHaveLength(0);
    expect(view?.removed).toEqual([
      { productId: rice, name: `Notice Rice ${suffix}`, reason: 'unlisted' },
    ]);
  });
});

describe('R1 — none of this writes stock or orders', () => {
  it('leaves the ledger, orders and shelf untouched', async () => {
    const snapshot = async () => ({
      orders: await prisma.order.count(),
      ledger: await prisma.stockLedger.count({ where: { storeId } }),
      stock: await prisma.inventoryItem.findMany({
        where: { storeId },
        select: { productId: true, websiteStock: true },
        orderBy: { productId: 'asc' },
      }),
    });

    const token = await newCart();
    await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 2 });

    const before = await snapshot();
    await addItem(shopper, { cartToken: token, storeId, productId: rice, qty: 1 });
    await setQuantity(shopper, { cartToken: token, productId: rice, qty: 5 });
    await removeItem(shopper, { cartToken: token, productId: rice });
    await viewCart(shopper, token);

    expect(await snapshot()).toEqual(before);
  });
});
