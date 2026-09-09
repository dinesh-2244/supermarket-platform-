import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearEventHandlersForTests,
  getPrisma,
  on,
  type DomainEvents,
  type Principal,
} from '@/modules/platform';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addItem, ensureCart } from '@/modules/cart';
import { signUp, verifyCustomerCredentials } from '@/modules/customers';
import { placeOrder } from '@/modules/checkout';
import { orderForTracking } from '@/modules/orders';
import { adjustStock } from '@/modules/inventory';
import {
  createCategory,
  createDeliveryArea,
  createDeliveryZone,
  createInventoryItem,
  createProduct,
  createStore,
  createStoreProduct,
  createStoreSettings,
  createUser,
} from '../factories/index';

/**
 * P4-2 — `checkout.placeOrder()`, the one transaction Phase 4 turns on.
 *
 * Everything here is about what commits together. The unit tests next door cover
 * the arithmetic; these cover the promise that a shopper never ends up with an
 * order whose stock was not taken, stock taken for an order that was not
 * written, or two orders from one basket.
 */
const prisma = getPrisma();

let storeId: string;
let otherStoreId: string;
let areaId: string;
let otherAreaId: string;
let rice: string;
let dal: string;
let admin: Principal;
let adminId: string;
let categoryId: string;
const userIds: string[] = [];
const productIds: string[] = [];
const cartTokens: string[] = [];

/**
 * A bookable window. The factory store is `Asia/Kolkata`, and slots sit on the
 * hour *locally* — so on the hour IST is half past the hour UTC. Two hours after
 * NOW clears the lead time.
 */
const SLOT = new Date('2026-12-01T10:30:00Z');
/** A second bookable window, one hour on. Used to separate two guards below. */
const OTHER_SLOT = new Date('2026-12-01T11:30:00Z');
const NOW = new Date('2026-12-01T08:00:00Z');

const guest: Principal = { kind: 'customer', customerId: null, storeId: null };

/** A listed, stocked product in `store`. Returns its id. */
async function stockedProduct(
  store: string,
  options: { stock: number; pricePaise: number },
): Promise<string> {
  const product = await createProduct(prisma, { categoryId });
  productIds.push(product.id);
  await createStoreProduct(prisma, store, product.id, {
    sellingPricePaise: options.pricePaise,
    isListed: true,
  });
  await createInventoryItem(prisma, store, product.id, { websiteStock: options.stock });
  return product.id;
}

beforeAll(async () => {
  categoryId = (await createCategory(prisma)).id;

  const first = await createStore(prisma);
  storeId = first.id;
  await createStoreSettings(prisma, storeId, {
    minOrderPaise: 0,
    deliveryFeePaise: 3_000,
    // Every test in this file books the same window; capacity is P4-3's
    // subject, and a default of 10 would make this file's later tests fail for
    // a reason that has nothing to do with what they assert.
    slotCapacity: 500,
  });

  const second = await createStore(prisma);
  otherStoreId = second.id;
  await createStoreSettings(prisma, otherStoreId);

  const superUser = await createUser(prisma, { role: 'SUPER_ADMIN', storeId: null });
  adminId = superUser.id;
  userIds.push(superUser.id);
  admin = { kind: 'user', userId: superUser.id, role: 'SUPER_ADMIN', storeId: null };

  rice = await stockedProduct(storeId, { stock: 50, pricePaise: 9_900 });
  dal = await stockedProduct(storeId, { stock: 50, pricePaise: 12_000 });
  await stockedProduct(otherStoreId, { stock: 50, pricePaise: 9_900 });

  const zone = await createDeliveryZone(prisma, storeId);
  areaId = (await createDeliveryArea(prisma, zone.id, { name: 'Checkout Area' })).id;
  const otherZone = await createDeliveryZone(prisma, otherStoreId);
  otherAreaId = (await createDeliveryArea(prisma, otherZone.id, { name: 'Other Area' })).id;
});

afterAll(async () => {
  const stores = [storeId, otherStoreId];
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [adminId, ...userIds] } } });
  await prisma.orderStatusHistory.deleteMany({ where: { order: { storeId: { in: stores } } } });
  await prisma.order.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.cartItem.deleteMany({ where: { cart: { cartToken: { in: cartTokens } } } });
  await prisma.cart.deleteMany({ where: { cartToken: { in: cartTokens } } });
  await prisma.deliveryArea.deleteMany({ where: { zone: { storeId: { in: stores } } } });
  await prisma.deliveryZone.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: { in: stores } } } });
  await prisma.stockLedger.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.customer.deleteMany({ where: { phone: { startsWith: '98765' } } });
  await prisma.orderLine.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  clearEventHandlersForTests();
});

afterEach(() => {
  clearEventHandlersForTests();
});

/** A basket in `store`, holding `qty` of `productId`. Returns its token. */
async function basketWith(
  store: string,
  productId: string,
  qty: number,
  extra?: { productId: string; qty: number },
): Promise<string> {
  const shopper: Principal = { kind: 'customer', customerId: null, storeId: store };
  const { cart } = await ensureCart(store, null);
  cartTokens.push(cart.cartToken);
  await addItem(shopper, { cartToken: cart.cartToken, storeId: store, productId, qty });
  if (extra) await addItem(shopper, { cartToken: cart.cartToken, storeId: store, ...extra });
  return cart.cartToken;
}

function order(cartToken: string, overrides: Record<string, unknown> = {}) {
  return {
    cartToken,
    contact: { name: 'Asha Rao', phone: '9876500001' },
    addressInput: { areaId },
    addressLines: { line1: '12 Test Street' },
    slotStart: SLOT,
    paymentMethod: 'COD',
    now: NOW,
    ...overrides,
  };
}

async function stockOf(productId: string, store = storeId): Promise<number> {
  const item = await prisma.inventoryItem.findFirstOrThrow({
    where: { storeId: store, productId },
  });
  return item.websiteStock;
}

describe('the happy path', () => {
  it('decrements each line once, writes one ledger row per line, and converts the cart', async () => {
    const riceBefore = await stockOf(rice);
    const dalBefore = await stockOf(dal);
    const token = await basketWith(storeId, rice, 3, { productId: dal, qty: 2 });

    const placed = await placeOrder(guest, order(token));

    expect(placed.orderNumber).toMatch(/^T\d+-\d{6}-[0-9A-Z]{5}$/);
    expect(placed.trackingToken).toMatch(/^t_[0-9A-Z]{20}$/);
    expect(placed.subtotalPaise).toBe(9_900 * 3 + 12_000 * 2);
    expect(placed.estimatedTotalPaise).toBe(placed.subtotalPaise + placed.deliveryFeePaise);
    expect(placed.slotEnd.getTime() - placed.slotStart.getTime()).toBe(60 * 60 * 1000);

    expect(await stockOf(rice)).toBe(riceBefore - 3);
    expect(await stockOf(dal)).toBe(dalBefore - 2);

    const ledger = await prisma.stockLedger.findMany({
      where: { storeId, reason: 'ORDER_PLACED', productId: { in: [rice, dal] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(ledger).toHaveLength(2);
    expect(ledger.find((row) => row.productId === rice)).toMatchObject({
      delta: -3,
      balanceAfter: riceBefore - 3,
    });
    expect(ledger.find((row) => row.productId === dal)).toMatchObject({
      delta: -2,
      balanceAfter: dalBefore - 2,
    });

    const saved = await prisma.order.findUniqueOrThrow({
      where: { id: placed.orderId },
      include: { lines: true, statusHistory: true },
    });
    expect(saved.status).toBe('PLACED');
    expect(saved.lines).toHaveLength(2);
    expect(saved.contactNameSnapshot).toBe('Asha Rao');
    expect(saved.statusHistory).toHaveLength(1);

    const cart = await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } });
    expect(cart.status).toBe('CONVERTED');
  });

  it('emits order.placed exactly once, after the commit', async () => {
    const seen: DomainEvents['order.placed'][] = [];
    on('order.placed', (payload) => seen.push(payload));

    const token = await basketWith(storeId, rice, 1);
    const placed = await placeOrder(guest, order(token));

    expect(seen).toEqual([{ orderId: placed.orderId, storeId }]);
  });

  it('creates a lightweight customer by phone, with no password', async () => {
    const token = await basketWith(storeId, rice, 1);
    await placeOrder(guest, order(token, { contact: { name: 'Nita', phone: '9876500002' } }));

    const customer = await prisma.customer.findUniqueOrThrow({ where: { phone: '9876500002' } });
    expect(customer.name).toBe('Nita');
    expect(customer.passwordHash).toBeNull();
    expect(customer.email).toBeNull();
  });

  it('reuses that customer on the next order and refreshes the name', async () => {
    const first = await basketWith(storeId, rice, 1);
    await placeOrder(guest, order(first, { contact: { name: 'Ravi K', phone: '9876500003' } }));
    const second = await basketWith(storeId, rice, 1);
    await placeOrder(
      guest,
      order(second, { contact: { name: 'Ravi Kumar', phone: '9876500003' } }),
    );

    const customers = await prisma.customer.findMany({ where: { phone: '9876500003' } });
    expect(customers).toHaveLength(1);
    expect(customers[0]?.name).toBe('Ravi Kumar');
  });

  it('snapshots the line names and prices so a later price change cannot move them', async () => {
    const token = await basketWith(storeId, rice, 2);
    const placed = await placeOrder(guest, order(token));

    const before = await prisma.orderLine.findFirstOrThrow({
      where: { orderId: placed.orderId, productId: rice },
    });
    await prisma.storeProduct.updateMany({
      where: { storeId, productId: rice },
      data: { sellingPricePaise: 20_000 },
    });
    await prisma.product.update({ where: { id: rice }, data: { name: 'Renamed Rice' } });

    const after = await prisma.orderLine.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.unitPricePaise).toBe(before.unitPricePaise);
    expect(after.nameSnapshot).toBe(before.nameSnapshot);

    await prisma.storeProduct.updateMany({
      where: { storeId, productId: rice },
      data: { sellingPricePaise: 9_900 },
    });
  });
});

describe('rejections write no order and take no stock', () => {
  async function expectNothingWritten(fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
    const before = await stockOf(rice);
    const orders = await prisma.order.count();
    await expect(fn()).rejects.toThrow(pattern);
    expect(await stockOf(rice)).toBe(before);
    expect(await prisma.order.count()).toBe(orders);
  }

  it('refuses an address we do not deliver to', async () => {
    const token = await basketWith(storeId, rice, 1);
    await expectNothingWritten(
      () => placeOrder(guest, order(token, { addressInput: { pincode: '999999' } })),
      /do not deliver/i,
    );
    expect((await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } })).status).toBe(
      'ACTIVE',
    );
  });

  it('refuses an address that resolves to a different shop than the basket', async () => {
    const token = await basketWith(storeId, rice, 1);
    await expectNothingWritten(
      () => placeOrder(guest, order(token, { addressInput: { areaId: otherAreaId } })),
      /different shop/i,
    );
  });

  it('refuses a basket under the shop’s minimum order', async () => {
    const token = await basketWith(storeId, rice, 1);
    await prisma.storeSettings.updateMany({ where: { storeId }, data: { minOrderPaise: 500_000 } });
    try {
      await expectNothingWritten(() => placeOrder(guest, order(token)), /minimum order/i);
    } finally {
      // `finally`, because a failed assertion here would otherwise leave every
      // later test in this file shopping at a store with a ₹5000 minimum.
      await prisma.storeSettings.updateMany({ where: { storeId }, data: { minOrderPaise: 0 } });
    }
  });

  it('refuses when a line cannot be filled, and names the line', async () => {
    const token = await basketWith(storeId, rice, 5);
    const available = await stockOf(rice);
    const ledgerBefore = await prisma.stockLedger.count({
      where: { storeId, productId: rice, reason: 'ORDER_PLACED' },
    });
    // Take the shelf down to less than the basket wants, behind the shopper.
    await adjustStock(admin, {
      storeId,
      productId: rice,
      delta: -(available - 2),
      note: 'test',
    });

    try {
      await placeOrder(guest, order(token));
      expect.unreachable('a short line must be refused');
    } catch (error) {
      expect((error as Error).message).toMatch(/no longer available/i);
      const details = (error as { details?: { lines?: { reason: string }[] } }).details;
      expect(details?.lines?.[0]).toMatchObject({ productId: rice, reason: 'insufficient-stock' });
    }

    // Full rollback: the shelf is exactly where the adjustment left it, and the
    // refused placement added no ledger row of its own.
    expect(await stockOf(rice)).toBe(2);
    expect(
      await prisma.stockLedger.count({
        where: { storeId, productId: rice, reason: 'ORDER_PLACED' },
      }),
    ).toBe(ledgerBefore);

    await adjustStock(admin, { storeId, productId: rice, delta: 48, note: 'restore' });
  });

  it('refuses an empty basket', async () => {
    const { cart } = await ensureCart(storeId, null);
    cartTokens.push(cart.cartToken);
    await expectNothingWritten(() => placeOrder(guest, order(cart.cartToken)), /basket is empty/i);
  });

  it('refuses a slot the grid does not offer', async () => {
    // Off the grid (10:00 UTC is 15:30 IST, mid-window), in the past, and
    // inside the lead time — all answered by the same check, because the grid
    // is generated once and asked, never re-derived.
    const token = await basketWith(storeId, rice, 1);
    for (const slotStart of [
      new Date('2026-12-01T10:00:00Z'),
      new Date('2026-11-30T10:30:00Z'),
      new Date('2026-12-01T08:30:00Z'),
    ]) {
      await expectNothingWritten(
        () => placeOrder(guest, order(token, { slotStart })),
        /not available/i,
      );
    }
  });

  it('refuses a payment method that is not on offer', async () => {
    const token = await basketWith(storeId, rice, 1);
    await expectNothingWritten(
      () => placeOrder(guest, order(token, { paymentMethod: 'CARD' })),
      /how you will pay/i,
    );
  });

  it('refuses while the shop is not taking orders', async () => {
    // Routed through `resolveServiceability`, which answers `store-closed` — the
    // one place that decides whether a shop is open.
    const token = await basketWith(storeId, rice, 1);
    await prisma.storeSettings.updateMany({
      where: { storeId },
      data: { isAcceptingOrders: false },
    });
    try {
      await expectNothingWritten(() => placeOrder(guest, order(token)), /not taking orders/i);
    } finally {
      await prisma.storeSettings.updateMany({
        where: { storeId },
        data: { isAcceptingOrders: true },
      });
    }
  });

  it('refuses a missing contact name or phone', async () => {
    const token = await basketWith(storeId, rice, 1);
    await expectNothingWritten(
      () => placeOrder(guest, order(token, { contact: { name: '  ', phone: '9876500009' } })),
      /who to deliver to/i,
    );
    await expectNothingWritten(
      () => placeOrder(guest, order(token, { contact: { name: 'Asha', phone: '  ' } })),
      /phone number/i,
    );
  });
});

describe('concurrency', () => {
  it('gives the last unit to exactly one of two simultaneous shoppers', async () => {
    // A product of its own, so the count is unambiguous.
    const solo = await stockedProduct(storeId, { stock: 1, pricePaise: 5_000 });

    const first = await basketWith(storeId, solo, 1);
    const second = await basketWith(storeId, solo, 1);

    const results = await Promise.allSettled([
      placeOrder(guest, order(first, { contact: { name: 'A', phone: '9876500011' } })),
      placeOrder(guest, order(second, { contact: { name: 'B', phone: '9876500012' } })),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The shelf is empty, not negative, and exactly one ledger row explains it.
    expect(await stockOf(solo)).toBe(0);
    const ledger = await prisma.stockLedger.findMany({
      where: { storeId, productId: solo, reason: 'ORDER_PLACED' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: -1, balanceAfter: 0 });
  });

  it('gives the last unit to one shopper even when they book different windows', async () => {
    // The decisive test for the **inventory row lock** (OSCAR R9).
    //
    // `placeOrder` takes the delivery-window mutex before it touches inventory,
    // so two shoppers competing for the last unit *in the same window* are
    // serialised by that mutex whatever the row lock does. Give them different
    // windows and the mutex takes different keys: the only thing left standing
    // between them and a negative shelf is `SELECT … FOR UPDATE` on the
    // `InventoryItem`, plus the refusal to go below zero.
    const solo = await stockedProduct(storeId, { stock: 1, pricePaise: 5_000 });
    const first = await basketWith(storeId, solo, 1);
    const second = await basketWith(storeId, solo, 1);

    const results = await Promise.allSettled([
      placeOrder(guest, order(first, { contact: { name: 'W1', phone: '9876500051' } })),
      placeOrder(
        guest,
        order(second, {
          slotStart: OTHER_SLOT,
          contact: { name: 'W2', phone: '9876500052' },
        }),
      ),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);

    // Exact counts, not "greater than zero": one order, one ledger row, an empty
    // shelf that never went negative.
    expect(await stockOf(solo)).toBe(0);
    expect(
      await prisma.order.count({
        where: { storeId, contactPhoneSnapshot: { in: ['9876500051', '9876500052'] } },
      }),
    ).toBe(1);
    expect(await prisma.orderLine.count({ where: { productId: solo } })).toBe(1);

    const ledger = await prisma.stockLedger.findMany({
      where: { storeId, productId: solo, reason: 'ORDER_PLACED' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: -1, balanceAfter: 0 });
  });

  it('gives the last unit to exactly one of four shoppers, each in a different window', async () => {
    // The two-shopper version of this race is not a reliable probe of the
    // inventory row lock: `placeOrder` does several awaits before it touches
    // stock, so two placements often do not overlap at that step at all, and the
    // test passes with the lock removed. Four contenders, each in a **different**
    // delivery window so the window mutex serialises none of them, make the
    // overlap real — which is what turns this into a negative check that bites.
    //
    // Four and not more, deliberately: `SELECT … FOR UPDATE` *blocks*, and a
    // blocked transaction holds its connection, so six racers against CI's
    // five-connection pool starve it and every one of them fails. That is the
    // same pile-up the delivery-window lock was changed to avoid, and it is
    // worth knowing about — but a test that trips it is measuring the pool, not
    // the row lock.
    const solo = await stockedProduct(storeId, { stock: 1, pricePaise: 5_000 });
    const windows = [0, 1, 2, 3].map((hour) => new Date(SLOT.getTime() + hour * 60 * 60 * 1000));

    const tokens: string[] = [];
    for (const _window of windows) tokens.push(await basketWith(storeId, solo, 1));

    const results = await Promise.allSettled(
      tokens.map((token, index) =>
        placeOrder(
          guest,
          order(token, {
            slotStart: windows[index],
            contact: { name: `Racer ${String(index)}`, phone: `98765006${String(index)}0` },
          }),
        ),
      ),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(windows.length - 1);

    // Exact counts. A shelf that went negative, or two orders for one unit,
    // fails here — and both are what the row lock is for.
    expect(await stockOf(solo)).toBe(0);
    expect(await prisma.orderLine.count({ where: { productId: solo } })).toBe(1);
    const ledger = await prisma.stockLedger.findMany({
      where: { storeId, productId: solo, reason: 'ORDER_PLACED' },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ delta: -1, balanceAfter: 0 });
  });

  it('places exactly one order when the same basket is submitted twice at once', async () => {
    const before = await stockOf(rice);
    const token = await basketWith(storeId, rice, 2);

    const results = await Promise.allSettled([
      placeOrder(guest, order(token)),
      placeOrder(guest, order(token)),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    // The decisive assertion: one submission, one decrement. Counted against
    // this basket's own lines rather than a shared phone number — `> 0` said
    // almost nothing, since every other test in this file uses that phone
    // (OSCAR R9).
    expect(await stockOf(rice)).toBe(before - 2);
    const cart = await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } });
    expect(cart.status).toBe('CONVERTED');

    const placed = results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<{
      orderId: string;
    }>;
    expect(
      await prisma.orderLine.count({ where: { orderId: placed.value.orderId, productId: rice } }),
    ).toBe(1);
    expect(await prisma.stockLedger.count({ where: { refType: 'Cart', refId: cart.id } })).toBe(1);
  });

  it('places exactly one order when one basket is submitted into two different windows', async () => {
    // The decisive test for the **cart row lock**, and the reason the test above
    // is not enough on its own.
    //
    // `placeOrder` takes the delivery-window mutex before the cart lock. When
    // two submissions name the *same* window, that mutex serialises them by
    // itself — so the test above would still pass with the cart lock removed,
    // and it proves the outcome without isolating which guard produced it.
    // (Confirmed by mutation: making `lockActiveCart` a non-locking read leaves
    // the same-slot test green.)
    //
    // Two *different* windows take two different lock keys, so the mutex cannot
    // serialise anything. Only the cart row lock stands between one basket and
    // two orders.
    const before = await stockOf(rice);
    const token = await basketWith(storeId, rice, 2);

    const results = await Promise.allSettled([
      placeOrder(guest, order(token, { contact: { name: 'Split A', phone: '9876500021' } })),
      placeOrder(
        guest,
        order(token, {
          slotStart: OTHER_SLOT,
          contact: { name: 'Split B', phone: '9876500022' },
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    // One basket, one decrement, one order — whichever window won.
    expect(await stockOf(rice)).toBe(before - 2);
    expect((await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } })).status).toBe(
      'CONVERTED',
    );
    expect(
      await prisma.order.count({
        where: { storeId, contactPhoneSnapshot: { in: ['9876500021', '9876500022'] } },
      }),
    ).toBe(1);
    const cart = await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } });
    expect(await prisma.stockLedger.count({ where: { refType: 'Cart', refId: cart.id } })).toBe(1);
  });

  it('refuses a second, sequential submission of a converted basket', async () => {
    const token = await basketWith(storeId, rice, 1);
    await placeOrder(guest, order(token));

    const before = await stockOf(rice);
    await expect(placeOrder(guest, order(token))).rejects.toThrow(/no longer active/i);
    expect(await stockOf(rice)).toBe(before);
  });

  it('does not deadlock when two multi-line baskets share products', async () => {
    // Both baskets hold the same two products. Without the deterministic
    // productId ordering in placeOrder, one could take rice then dal while the
    // other takes dal then rice, and Postgres would have to break the cycle.
    const before = { rice: await stockOf(rice), dal: await stockOf(dal) };
    const first = await basketWith(storeId, rice, 1, { productId: dal, qty: 1 });
    const second = await basketWith(storeId, dal, 1, { productId: rice, qty: 1 });

    const results = await Promise.allSettled([
      placeOrder(guest, order(first, { contact: { name: 'C', phone: '9876500013' } })),
      placeOrder(guest, order(second, { contact: { name: 'D', phone: '9876500014' } })),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
    expect(await stockOf(rice)).toBe(before.rice - 2);
    expect(await stockOf(dal)).toBe(before.dal - 2);
  });
});

describe('a guest order does not lock the phone number out of an account (R2)', () => {
  it('lets that phone sign up afterwards, and sign in', async () => {
    // The defect: checkout upserts a lightweight Customer keyed on phone with no
    // email and no password. `signUp` then found an existing phone and returned
    // its neutral response without creating credentials, so the number could
    // never become an account — ordering once as a guest locked you out for good.
    const phone = '9876500031';
    const email = `guest.${Date.now() % 1_000_000}@example.test`;
    const password = 'GuestToAccount1';

    const token = await basketWith(storeId, rice, 1);
    await placeOrder(guest, order(token, { contact: { name: 'Guest First', phone } }));

    const contact = await prisma.customer.findUniqueOrThrow({ where: { phone } });
    expect(contact.passwordHash).toBeNull();
    expect(contact.email).toBeNull();

    await signUp({ name: 'Guest Later', email, phone, password });

    const account = await prisma.customer.findUniqueOrThrow({ where: { phone } });
    expect(account.id).toBe(contact.id);
    expect(account.email).toBe(email);
    expect(account.passwordHash).not.toBeNull();

    // …and the credentials actually work, which is the part the defect broke.
    const verified = await verifyCustomerCredentials(email, password);
    expect(verified).not.toBeNull();
    expect(verified?.id).toBe(contact.id);
  });

  it('still says nothing when the phone belongs to a real account', async () => {
    // The enumeration guard this function exists for is untouched: a *credentialled*
    // row is silently left alone, so a caller cannot tell a taken number from a
    // free one by the response.
    const phone = '9876500032';
    const first = `taken.${Date.now() % 1_000_000}@example.test`;
    await signUp({ name: 'Real Account', email: first, phone, password: 'RealAccount1' });
    const before = await prisma.customer.findUniqueOrThrow({ where: { phone } });

    const second = `attacker.${Date.now() % 1_000_000}@example.test`;
    await expect(
      signUp({ name: 'Not Me', email: second, phone, password: 'Attacker123' }),
    ).resolves.toBeUndefined();

    const after = await prisma.customer.findUniqueOrThrow({ where: { phone } });
    expect(after.email).toBe(before.email);
    expect(after.passwordHash).toBe(before.passwordHash);
    expect(after.name).toBe('Real Account');
    // The attacker's address never becomes a way in.
    expect(await verifyCustomerCredentials(second, 'Attacker123')).toBeNull();
  });

  it('claiming a contact row exposes no order history', () => {
    // The claim is deliberate, but it must not hand anything over. The account
    // area lists no orders at all in Phase 4; when it does, it must be gated on a
    // verified phone rather than on having typed one. This pins the current
    // surface so that change cannot happen by accident.
    const page = readFileSync(
      join(process.cwd(), 'src', 'app', '(storefront)', 'account', 'orders', 'page.tsx'),
      'utf8',
    );

    expect(page).not.toMatch(/\border\b\s*\./i);
    expect(page).not.toContain('@/modules/orders');
    expect(page).toContain('No orders yet');
  });
});

describe('the address a rider actually navigates by (R6)', () => {
  it('refuses a blank street address, and one that is absurdly long', async () => {
    const token = await basketWith(storeId, rice, 1);

    await expect(
      placeOrder(guest, order(token, { addressLines: { line1: '   ' } })),
    ).rejects.toThrow(/street address/i);
    await expect(placeOrder(guest, order(token, { addressLines: {} }))).rejects.toThrow(
      /street address/i,
    );
    await expect(
      placeOrder(guest, order(token, { addressLines: { line1: 'x'.repeat(201) } })),
    ).rejects.toThrow(/longer than 200/i);
    await expect(
      placeOrder(guest, order(token, { addressLines: { line1: 'ok', line2: 'y'.repeat(201) } })),
    ).rejects.toThrow(/longer than 200/i);

    expect((await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } })).status).toBe(
      'ACTIVE',
    );
  });

  it('freezes the locality and pincode from the store’s own area record', async () => {
    // OSCAR's repro shape: the real form posts an `areaId` and nothing else.
    // Taking locality/pincode from the *input* meant every UI order snapshotted
    // both as null, and the tracking page had no locality to show.
    const token = await basketWith(storeId, rice, 1);
    const placed = await placeOrder(
      guest,
      order(token, {
        addressInput: { areaId },
        addressLines: { line1: '9 Real Street', line2: 'Near the park' },
        contact: { name: 'Address Tester', phone: '9876500041' },
      }),
    );

    const saved = await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    const snapshot = saved.deliveryAddressSnapshotJson as Record<string, unknown>;

    expect(snapshot.line1).toBe('9 Real Street');
    expect(snapshot.line2).toBe('Near the park');
    expect(snapshot.areaId).toBe(areaId);
    expect(snapshot.locality).toBe('Checkout Area');
    expect(snapshot.locality).not.toBeNull();

    // …and the guest tracking projection therefore has something to render.
    const tracked = await orderForTracking(placed.trackingToken);
    expect(tracked?.deliveryLocality).toBe('Checkout Area');
  });

  it('ignores a locality the caller invents, preferring the store’s record', async () => {
    // The area id is a fact we can look up; a locality string a caller typed is
    // not, and must never end up on the order as though it were.
    const token = await basketWith(storeId, rice, 1);
    const placed = await placeOrder(
      guest,
      order(token, {
        addressInput: { areaId, locality: 'Somewhere Else Entirely' },
        addressLines: { line1: '11 Elsewhere Road' },
        contact: { name: 'Liar', phone: '9876500042' },
      }),
    );

    const saved = await prisma.order.findUniqueOrThrow({ where: { id: placed.orderId } });
    const snapshot = saved.deliveryAddressSnapshotJson as Record<string, unknown>;
    expect(snapshot.locality).toBe('Checkout Area');
  });
});

describe('checkout says what the revalidation found (R5)', () => {
  it('carries the offending lines on the rejection, not just a generic message', async () => {
    // The page and the action both need this: `ShortfallError.details.lines`
    // names each line so the shopper is told *which* item to fix.
    const token = await basketWith(storeId, rice, 6);
    const available = await stockOf(rice);
    await adjustStock(admin, {
      storeId,
      productId: rice,
      delta: -(available - 2),
      note: 'squeeze',
    });

    try {
      await placeOrder(guest, order(token));
      expect.unreachable('a short line must be refused');
    } catch (error) {
      const details = (error as { details?: { reason?: string; lines?: unknown[] } }).details;
      expect(details?.reason).toBe('stock-shortfall');
      expect(details?.lines).toHaveLength(1);
      expect(details?.lines?.[0]).toMatchObject({
        productId: rice,
        reason: 'insufficient-stock',
        available: 2,
      });
      // The name is what the shopper is shown, so it has to be there.
      expect((details?.lines?.[0] as { name?: string }).name).toBeTruthy();
    } finally {
      await adjustStock(admin, { storeId, productId: rice, delta: available - 2, note: 'restore' });
    }
  });
});
