import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, withTransaction, type Principal } from '@/modules/platform';
import { applyTransition, createOrder, ordersForCustomer } from '@/modules/orders';
import {
  createCategory,
  createCustomer,
  createInventoryItem,
  createProduct,
  createStore,
  createStoreProduct,
  createStoreSettings,
  createUser,
} from '../factories/index';

/**
 * The account order-history read (`orders-for-customer-read-query`).
 *
 * What is on trial is the scope: the signed-in shopper sees every order they
 * placed, newest first, and nothing anybody else placed — and the read carries
 * the tracking token so the page can link straight to `/order-status/[token]`.
 * The same discipline as `orderForTracking`: the query itself is what cannot
 * return another shopper's row, not the caller's good intentions.
 */
const prisma = getPrisma();

let storeId: string;
let categoryId: string;
let productId: string;
let ashaId: string;
let raviId: string;
let managerId: string;
let manager: Principal;
let asha: Principal;
let ravi: Principal;
let ashaOrders: { id: string; orderNumber: string; token: string; placedAt: Date }[];
let raviOrder: { id: string; orderNumber: string; token: string; placedAt: Date };

beforeAll(async () => {
  categoryId = (await createCategory(prisma)).id;
  const store = await createStore(prisma, { name: 'History Test Shop', timezone: 'Asia/Kolkata' });
  storeId = store.id;
  await createStoreSettings(prisma, storeId);

  const product = await createProduct(prisma, { categoryId, name: 'History Rice' });
  productId = product.id;
  await createStoreProduct(prisma, storeId, productId, { sellingPricePaise: 9_900 });
  await createInventoryItem(prisma, storeId, productId, { websiteStock: 100 });

  ashaId = (await createCustomer(prisma, { name: 'Asha Rao' })).id;
  raviId = (await createCustomer(prisma, { name: 'Ravi Kumar' })).id;
  asha = { kind: 'customer', customerId: ashaId, storeId };
  ravi = { kind: 'customer', customerId: raviId, storeId };
  const user = await createUser(prisma, { role: 'STORE_MANAGER', storeId });
  managerId = user.id;
  manager = { kind: 'user', userId: user.id, role: 'STORE_MANAGER', storeId };

  // Three for Asha at distinct, known instants; one for Ravi in between them.
  ashaOrders = [
    await place(ashaId, new Date('2026-09-01T09:00:00Z')),
    await place(ashaId, new Date('2026-09-05T09:00:00Z')),
    await place(ashaId, new Date('2026-09-10T09:00:00Z')),
  ];
  raviOrder = await place(raviId, new Date('2026-09-07T09:00:00Z'));
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { entityType: 'Order' } });
  await prisma.order.deleteMany({ where: { storeId } });
  await prisma.stockLedger.deleteMany({ where: { storeId } });
  await prisma.inventoryItem.deleteMany({ where: { storeId } });
  await prisma.storeProduct.deleteMany({ where: { storeId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.user.deleteMany({ where: { id: managerId } });
  await prisma.customer.deleteMany({ where: { id: { in: [ashaId, raviId] } } });
  await prisma.$disconnect();
});

async function place(
  customerId: string,
  placedAt: Date,
): Promise<{ id: string; orderNumber: string; token: string; placedAt: Date }> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const created = await withTransaction((tx) =>
    createOrder(tx, {
      storeCode: store.code,
      customerId,
      storeId,
      contactName: 'Shopper',
      contactPhone: '9000000123',
      deliveryAddressSnapshot: { locality: 'Indiranagar', pincode: '560038' },
      deliverySlotStart: new Date('2026-12-01T10:30:00Z'),
      deliverySlotEnd: new Date('2026-12-01T11:30:00Z'),
      paymentMethod: 'COD',
      subtotalPaise: 9_900,
      deliveryFeePaise: 3_000,
      lines: [
        {
          productId,
          nameSnapshot: 'History Rice',
          packSizeSnapshot: '1 kg',
          unitPricePaise: 9_900,
          qtyOrdered: 1,
        },
      ],
    }),
  );
  // `placedAt` defaults to now(); pin it so the ordering under test is known.
  await prisma.order.update({ where: { id: created.id }, data: { placedAt } });
  return {
    id: created.id,
    orderNumber: created.orderNumber,
    token: created.trackingToken,
    placedAt,
  };
}

describe('whose orders come back', () => {
  it("lists the shopper's own orders, newest first, with what the page needs", async () => {
    const orders = await ordersForCustomer(asha);

    expect(orders.map((o) => o.orderNumber)).toEqual(
      [ashaOrders[2]!, ashaOrders[1]!, ashaOrders[0]!].map((o) => o.orderNumber),
    );
    expect(orders[0]).toMatchObject({
      orderNumber: ashaOrders[2]!.orderNumber,
      trackingToken: ashaOrders[2]!.token,
      status: 'PLACED',
      statusLabel: 'Order placed',
      placedAt: ashaOrders[2]!.placedAt,
      slotStart: new Date('2026-12-01T10:30:00Z'),
      slotEnd: new Date('2026-12-01T11:30:00Z'),
      storeName: 'History Test Shop',
      storeTimeZone: 'Asia/Kolkata',
      estimatedTotalPaise: 12_900,
    });
    // Rendered in the shop's timezone (10:30Z is 16:00 IST), not the reader's.
    expect(orders[0]?.slotLabel).toContain('16:00');
    // Nothing a history list has no business carrying: no lines, no address.
    expect(orders[0]).not.toHaveProperty('lines');
    expect(orders[0]).not.toHaveProperty('deliveryLocality');
  });

  it("never includes another shopper's order", async () => {
    const numbers = (await ordersForCustomer(asha)).map((o) => o.orderNumber);
    expect(numbers).not.toContain(raviOrder.orderNumber);

    const ravis = await ordersForCustomer(ravi);
    expect(ravis.map((o) => o.orderNumber)).toEqual([raviOrder.orderNumber]);
  });

  it('is empty for a shopper who has never ordered', async () => {
    const newcomer = await createCustomer(prisma);
    try {
      expect(
        await ordersForCustomer({ kind: 'customer', customerId: newcomer.id, storeId }),
      ).toEqual([]);
    } finally {
      await prisma.customer.delete({ where: { id: newcomer.id } });
    }
  });

  it('reflects the current status, not the one at placement', async () => {
    await applyTransition(manager, ashaOrders[0]!.id, 'ACCEPTED');
    const orders = await ordersForCustomer(asha);
    const first = orders.find((o) => o.orderNumber === ashaOrders[0]!.orderNumber);
    expect(first).toMatchObject({ status: 'ACCEPTED', statusLabel: 'Accepted by the shop' });
  });

  it('honours a limit, still newest first', async () => {
    const orders = await ordersForCustomer(asha, { limit: 2 });
    expect(orders.map((o) => o.orderNumber)).toEqual(
      [ashaOrders[2]!, ashaOrders[1]!].map((o) => o.orderNumber),
    );
  });
});

describe('who may ask', () => {
  it('refuses a guest — a customer principal with no account', async () => {
    await expect(
      ordersForCustomer({ kind: 'customer', customerId: null, storeId }),
    ).rejects.toThrow('signed in');
  });

  it('refuses a staff principal — the back office has no account area', async () => {
    await expect(ordersForCustomer(manager)).rejects.toThrow('signed in');
  });

  it('refuses the system principal', async () => {
    await expect(ordersForCustomer({ kind: 'system' })).rejects.toThrow('signed in');
  });
});

describe('what it does not do', () => {
  it('writes nothing', async () => {
    const before = await prisma.auditLog.count();
    const history = await prisma.orderStatusHistory.count();
    await ordersForCustomer(asha);
    expect(await prisma.auditLog.count()).toBe(before);
    expect(await prisma.orderStatusHistory.count()).toBe(history);
  });
});
