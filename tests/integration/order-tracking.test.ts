import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, withTransaction, type Principal } from '@/modules/platform';
import { applyTransition, cancelByStore, createOrder, orderForTracking } from '@/modules/orders';
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
 * P4-5 — the guest tracking read.
 *
 * Two things are on trial. That the page can render an order from nothing but
 * its token, and — the one that matters — that the token is the *only* thing
 * that opens it: no enumeration, no timing tell, no other order's data, and no
 * write of any kind.
 */
const prisma = getPrisma();

let storeId: string;
let categoryId: string;
let productId: string;
let customerId: string;
let managerId: string;
let manager: Principal;
let token: string;
let orderId: string;
let otherToken: string;

beforeAll(async () => {
  categoryId = (await createCategory(prisma)).id;
  const store = await createStore(prisma, { name: 'Tracking Test Shop' });
  storeId = store.id;
  await createStoreSettings(prisma, storeId);

  const product = await createProduct(prisma, { categoryId, name: 'Tracked Rice' });
  productId = product.id;
  await createStoreProduct(prisma, storeId, productId, { sellingPricePaise: 9_900 });
  await createInventoryItem(prisma, storeId, productId, { websiteStock: 100 });

  customerId = (await createCustomer(prisma)).id;
  const user = await createUser(prisma, { role: 'STORE_MANAGER', storeId });
  managerId = user.id;
  manager = { kind: 'user', userId: user.id, role: 'STORE_MANAGER', storeId };

  const placed = await place();
  orderId = placed.id;
  token = placed.token;
  otherToken = (await place()).token;
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
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

async function place(): Promise<{ id: string; token: string }> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  return withTransaction(async (tx) => {
    const created = await createOrder(tx, {
      storeCode: store.code,
      customerId,
      storeId,
      contactName: 'Asha Rao',
      contactPhone: '9000000123',
      deliveryAddressSnapshot: { locality: 'Indiranagar', pincode: '560038' },
      deliverySlotStart: new Date('2026-12-01T10:30:00Z'),
      deliverySlotEnd: new Date('2026-12-01T11:30:00Z'),
      paymentMethod: 'COD',
      subtotalPaise: 19_800,
      deliveryFeePaise: 3_000,
      lines: [
        {
          productId,
          nameSnapshot: 'Tracked Rice',
          packSizeSnapshot: '1 kg',
          unitPricePaise: 9_900,
          qtyOrdered: 2,
        },
      ],
    });
    return { id: created.id, token: created.trackingToken };
  });
}

describe('what the token opens', () => {
  it('renders the order from nothing but the token', async () => {
    const order = await orderForTracking(token);

    expect(order).not.toBeNull();
    expect(order).toMatchObject({
      status: 'PLACED',
      statusLabel: 'Order placed',
      paymentMethod: 'COD',
      storeName: 'Tracking Test Shop',
      deliveryLocality: 'Indiranagar',
      subtotalPaise: 19_800,
      deliveryFeePaise: 3_000,
      estimatedTotalPaise: 22_800,
    });
    expect(order?.lines).toEqual([
      {
        name: 'Tracked Rice',
        packSize: '1 kg',
        unitPricePaise: 9_900,
        qty: 2,
        lineTotalPaise: 19_800,
      },
    ]);
  });

  it('renders the slot in the shop’s timezone, not UTC', async () => {
    // 10:30 UTC is 16:00 in Asia/Kolkata, and 16:00 is what the shop means.
    const order = await orderForTracking(token);
    expect(order?.slotLabel).toContain('16:00');
    expect(order?.storeTimeZone).toBe('Asia/Kolkata');
  });

  it('shows a timeline that grows as the order moves', async () => {
    const before = await orderForTracking(token);
    expect(before?.timeline.map((step) => step.status)).toEqual(['PLACED']);

    await applyTransition(manager, orderId, 'ACCEPTED');
    await applyTransition(manager, orderId, 'PICKING');

    const after = await orderForTracking(token);
    expect(after?.timeline.map((step) => step.status)).toEqual(['PLACED', 'ACCEPTED', 'PICKING']);
    expect(after?.timeline.map((step) => step.label)).toEqual([
      'Order placed',
      'Accepted by the shop',
      'Being picked',
    ]);
    expect(after?.statusLabel).toBe('Being picked');
  });

  it('says so plainly when the shop has cancelled', async () => {
    const cancelled = await place();
    await withTransaction((tx) => cancelByStore(tx, cancelled.id, manager, 'out of stock'));

    const order = await orderForTracking(cancelled.token);
    expect(order?.status).toBe('CANCELLED_BY_STORE');
    expect(order?.statusLabel).toBe('Cancelled by the shop');
  });

  it('freezes the line snapshots against a later price or name change', async () => {
    await prisma.storeProduct.updateMany({
      where: { storeId, productId },
      data: { sellingPricePaise: 50_000 },
    });
    await prisma.product.update({ where: { id: productId }, data: { name: 'Renamed Rice' } });

    const order = await orderForTracking(token);
    expect(order?.lines[0]).toMatchObject({ name: 'Tracked Rice', unitPricePaise: 9_900 });
    expect(order?.estimatedTotalPaise).toBe(22_800);

    await prisma.product.update({ where: { id: productId }, data: { name: 'Tracked Rice' } });
    await prisma.storeProduct.updateMany({
      where: { storeId, productId },
      data: { sellingPricePaise: 9_900 },
    });
  });
});

describe('what the token does not open', () => {
  it('answers null for a well-formed token that belongs to nobody', async () => {
    expect(await orderForTracking('t_AAAAAAAAAAAAAAAAAAAA')).toBeNull();
  });

  it('answers null for garbage, and does not throw', async () => {
    for (const bad of [
      '',
      '   ',
      'not-a-token',
      '../../etc/passwd',
      "' OR 1=1 --",
      '%00',
      't_',
      'x'.repeat(500),
      '🙂',
    ]) {
      await expect(orderForTracking(bad)).resolves.toBeNull();
    }
  });

  it('never returns one order for another’s token', async () => {
    const first = await orderForTracking(token);
    const second = await orderForTracking(otherToken);

    expect(first?.orderNumber).not.toBe(second?.orderNumber);
    expect(second?.trackingToken).toBe(otherToken);
  });

  it('leaks no customer identity — no phone, no email, no ids', async () => {
    // The token is unguessable but it is also *shareable*: a shopper forwards
    // the link to whoever is home to receive the delivery. What that person can
    // see should be the order, not the account behind it.
    const order = await orderForTracking(token);
    const serialized = JSON.stringify(order);

    expect(serialized).not.toContain('9000000123');
    expect(serialized).not.toContain(customerId);
    expect(serialized).not.toContain(orderId);
    expect(order).not.toHaveProperty('contactPhone');
    expect(order).not.toHaveProperty('customerId');
  });

  it('looks up on a unique index, so a hit and a miss do the same work', async () => {
    // Asserted against the schema, not a query plan: on a table this small
    // Postgres sequential-scans whatever indexes exist, so `EXPLAIN` here would
    // measure the fixture's size rather than the mechanism. What is actually
    // durable is that `trackingToken` carries a unique index, which is what
    // makes the hit and the miss the same single probe in production and a
    // timing attack pointless.
    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'Order'
    `;
    const onToken = indexes.filter((row) => row.indexdef.includes('trackingToken'));

    expect(onToken).toHaveLength(1);
    expect(onToken[0]?.indexdef).toMatch(/CREATE UNIQUE INDEX/i);
  });

  it('does not distinguish a miss from a hit in what it returns', async () => {
    // Both are `null` — not an error for one and null for the other, which is
    // the shape that usually leaks the difference.
    expect(await orderForTracking('t_AAAAAAAAAAAAAAAAAAAA')).toBeNull();
    expect(await orderForTracking('definitely not a token')).toBeNull();
  });
});

describe('the tracking read writes nothing', () => {
  it('leaves every table it touches exactly as it found it', async () => {
    const before = {
      orders: await prisma.order.count(),
      history: await prisma.orderStatusHistory.count(),
      lines: await prisma.orderLine.count(),
      ledger: await prisma.stockLedger.count(),
      audit: await prisma.auditLog.count(),
      stock: (await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } }))
        .websiteStock,
    };

    for (let i = 0; i < 5; i += 1) {
      await orderForTracking(token);
      await orderForTracking('t_AAAAAAAAAAAAAAAAAAAA');
    }

    expect({
      orders: await prisma.order.count(),
      history: await prisma.orderStatusHistory.count(),
      lines: await prisma.orderLine.count(),
      ledger: await prisma.stockLedger.count(),
      audit: await prisma.auditLog.count(),
      stock: (await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } }))
        .websiteStock,
    }).toEqual(before);
  });

  it('does not change the order’s own updatedAt', async () => {
    const before = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await orderForTracking(token);
    const after = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });

    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
  });
});
