import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  clearEventHandlersForTests,
  emit,
  getPrisma,
  withTransaction,
  type Principal,
} from '@/modules/platform';
import { confirmationDetails, correctOrder, createOrder } from '@/modules/orders';
import {
  currentProvider,
  noopProvider,
  orderConfirmationMessage,
  registerOrderNotifications,
  resetProvider,
  sendOrderConfirmation,
  setProviderForTests,
  type OutboundMessage,
} from '@/modules/notifications';
import {
  createCategory,
  createCustomer,
  createInventoryItem,
  createProduct,
  createStore,
  createStoreProduct,
  createStoreSettings,
} from '../factories/index';

/**
 * P4-7 — the events and notifications wiring, and the seed's idempotence.
 */
const prisma = getPrisma();

let storeId: string;
let categoryId: string;
let productId: string;
let customerId: string;
let orderId: string;

beforeAll(async () => {
  categoryId = (await createCategory(prisma)).id;
  const store = await createStore(prisma);
  storeId = store.id;
  await createStoreSettings(prisma, storeId);
  productId = (await createProduct(prisma, { categoryId })).id;
  await createStoreProduct(prisma, storeId, productId, { sellingPricePaise: 9_900 });
  await createInventoryItem(prisma, storeId, productId, { websiteStock: 50 });
  customerId = (await createCustomer(prisma)).id;

  orderId = await withTransaction(async (tx) => {
    const created = await createOrder(tx, {
      storeCode: store.code,
      customerId,
      storeId,
      contactName: 'Event Tester',
      contactPhone: '9000000555',
      deliveryAddressSnapshot: { locality: 'Indiranagar' },
      deliverySlotStart: new Date('2026-12-01T10:30:00Z'),
      deliverySlotEnd: new Date('2026-12-01T11:30:00Z'),
      paymentMethod: 'COD',
      subtotalPaise: 19_800,
      deliveryFeePaise: 3_000,
      lines: [
        {
          productId,
          nameSnapshot: 'Event Rice',
          packSizeSnapshot: '1 kg',
          unitPricePaise: 9_900,
          qtyOrdered: 2,
        },
      ],
    });
    return created.id;
  });
});

afterAll(async () => {
  await prisma.order.deleteMany({ where: { storeId } });
  await prisma.stockLedger.deleteMany({ where: { storeId } });
  await prisma.inventoryItem.deleteMany({ where: { storeId } });
  await prisma.storeProduct.deleteMany({ where: { storeId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

beforeEach(() => {
  clearEventHandlersForTests();
  resetProvider();
});

afterEach(() => {
  clearEventHandlersForTests();
  resetProvider();
});

/** A provider that records instead of sending. */
function recorder(): { sent: OutboundMessage[]; provider: typeof noopProvider } {
  const sent: OutboundMessage[] = [];
  return {
    sent,
    provider: {
      name: 'recorder',
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    },
  };
}

/** The handler's work happens on a microtask; let it drain. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/**
 * Remove the demo orders and everything hanging off them, so the seed run under
 * test actually creates them. The seed keys on order number and skips rows that
 * already exist, so a database seeded by an older build would otherwise leave
 * these assertions measuring history rather than behaviour.
 */
async function clearDemoOrders(): Promise<void> {
  const demo = await prisma.order.findMany({
    where: { orderNumber: { contains: '-DEMO-' } },
    select: { id: true },
  });
  const ids = demo.map((row) => row.id);
  if (ids.length === 0) return;

  // Undo the movements before deleting their rows. Removing a ledger row while
  // leaving the shelf decremented would leave the database in a state the
  // ledger cannot explain — which is the very thing these tests are about, and
  // it is not the fixture's place to create it.
  const movements = await prisma.stockLedger.findMany({
    where: { refType: 'Order', refId: { in: ids } },
  });
  for (const movement of movements) {
    const item = await prisma.inventoryItem.findFirst({
      where: { storeId: movement.storeId, productId: movement.productId },
      select: { id: true, websiteStock: true },
    });
    if (item === null) continue;
    await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { websiteStock: item.websiteStock - movement.delta },
    });
  }

  await prisma.stockLedger.deleteMany({ where: { refType: 'Order', refId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entityType: 'Order', entityId: { in: ids } } });
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
}

describe('order.placed reaches notifications', () => {
  it('sends exactly one confirmation per event', async () => {
    const { sent, provider } = recorder();
    setProviderForTests(provider);
    registerOrderNotifications(confirmationDetails);

    emit('order.placed', { orderId, storeId });
    await settle();

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: 'sms', template: 'order-confirmation' });
    expect(sent[0]?.data.orderNumber).toMatch(/^T\d+-\d{6}-[0-9A-Z]{5}$/);
    expect(sent[0]?.data.trackingPath).toMatch(/^\/order-status\/t_[0-9A-Z]{20}$/);
  });

  it('quotes the estimated total and the window in the shop’s own time', async () => {
    const { sent, provider } = recorder();
    setProviderForTests(provider);
    registerOrderNotifications(confirmationDetails);

    emit('order.placed', { orderId, storeId });
    await settle();

    expect(sent[0]?.data.estimatedTotal).toBe('₹228.00');
    // 10:30 UTC is 16:00 in Asia/Kolkata.
    expect(sent[0]?.data.slot).toContain('16:00');
  });

  it('does nothing, and does not throw, for an order that is not there', async () => {
    const { sent, provider } = recorder();
    setProviderForTests(provider);
    registerOrderNotifications(confirmationDetails);

    emit('order.placed', { orderId: '00000000-0000-4000-8000-000000000000', storeId });
    await settle();

    expect(sent).toEqual([]);
  });

  it('survives a provider that throws — an order must not fail over a message', async () => {
    setProviderForTests({
      name: 'broken',
      send: () => Promise.reject(new Error('vendor is down')),
    });
    registerOrderNotifications(confirmationDetails);

    expect(() => emit('order.placed', { orderId, storeId })).not.toThrow();
    await settle();
    await expect(
      sendOrderConfirmation({
        phone: '9000000555',
        orderNumber: 'X',
        trackingToken: 't_X',
        estimatedTotalPaise: 1,
        slotLabel: 'later',
      }),
    ).resolves.toBeUndefined();
  });

  it('unsubscribes cleanly', async () => {
    const { sent, provider } = recorder();
    setProviderForTests(provider);
    const off = registerOrderNotifications(confirmationDetails);
    off();

    emit('order.placed', { orderId, storeId });
    await settle();
    expect(sent).toEqual([]);
  });
});

describe('the shipped provider delivers nothing', () => {
  it('is the no-op provider by default', () => {
    expect(currentProvider().name).toBe('noop');
  });

  it('resolves without sending anything anywhere', async () => {
    await expect(
      noopProvider.send(
        orderConfirmationMessage({
          channel: 'sms',
          to: '9000000555',
          orderNumber: 'S1-DEMO-01',
          trackingToken: 't_ABC',
          estimatedTotalPaise: 12_345,
          slotLabel: 'Tue 1 Dec, 16:00 – 17:00',
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('puts no line items, address or customer id in the message', () => {
    // A confirmation is a receipt *pointer*, not a copy of the order.
    const message = orderConfirmationMessage({
      channel: 'sms',
      to: '9000000555',
      orderNumber: 'S1-DEMO-01',
      trackingToken: 't_ABC',
      estimatedTotalPaise: 12_345,
      slotLabel: 'Tue 1 Dec, 16:00 – 17:00',
    });

    expect(Object.keys(message.data).sort()).toEqual([
      'estimatedTotal',
      'orderNumber',
      'slot',
      'trackingPath',
    ]);
  });
});

describe('the seed is idempotent', () => {
  it('leaves every count stable when re-run', async () => {
    const countAll = async (): Promise<Record<string, number>> => ({
      stores: await prisma.store.count(),
      products: await prisma.product.count(),
      storeProducts: await prisma.storeProduct.count(),
      inventoryItems: await prisma.inventoryItem.count(),
      users: await prisma.user.count(),
      customers: await prisma.customer.count(),
      orders: await prisma.order.count(),
      orderLines: await prisma.orderLine.count(),
      orderStatusHistory: await prisma.orderStatusHistory.count(),
      stockLedger: await prisma.stockLedger.count(),
      featureFlags: await prisma.featureFlag.count(),
    });

    // Run it once so the demo rows certainly exist, then again to prove the
    // second run is a no-op. Counting "two orders per store" instead of keying
    // on the order number would double them every time.
    execFileSync('npx', ['tsx', 'prisma/seed.ts'], { env: process.env, stdio: 'ignore' });
    const before = await countAll();
    execFileSync('npx', ['tsx', 'prisma/seed.ts'], { env: process.env, stdio: 'ignore' });

    expect(await countAll()).toEqual(before);
  }, 120_000);

  it('deducts the stock its demo orders spend, with a ledger row each (R4)', async () => {
    // The defect: the seed created demo orders without decrementing anything, so
    // cancelling one through the ordinary admin correction restored a quantity
    // that had never been taken and a demo database grew stock out of nothing.
    //
    // Measured directly — the shelf before the seed against the shelf after —
    // rather than by reasoning over an accumulated ledger, which in a shared
    // test database says more about earlier tests than about this one.
    await clearDemoOrders();
    const before = new Map(
      (await prisma.inventoryItem.findMany({ select: { id: true, websiteStock: true } })).map(
        (item) => [item.id, item.websiteStock],
      ),
    );

    execFileSync('npx', ['tsx', 'prisma/seed.ts'], { env: process.env, stdio: 'ignore' });

    const demo = await prisma.order.findMany({
      where: { orderNumber: { contains: '-DEMO-' } },
      include: { lines: true },
    });
    expect(demo.length).toBeGreaterThan(0);

    // What every demo line took, added up per shelf.
    const expectedDrop = new Map<string, number>();
    for (const order of demo) {
      for (const line of order.lines) {
        const item = await prisma.inventoryItem.findFirstOrThrow({
          where: { storeId: order.storeId, productId: line.productId },
          select: { id: true },
        });
        expectedDrop.set(item.id, (expectedDrop.get(item.id) ?? 0) + line.qtyOrdered);
      }
    }
    expect(expectedDrop.size).toBeGreaterThan(0);

    for (const [itemId, drop] of expectedDrop) {
      const item = await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(item.websiteStock).toBe((before.get(itemId) ?? 0) - drop);
    }

    // …and each line's movement is on the ledger, pointing back at its order.
    for (const order of demo) {
      const ledger = await prisma.stockLedger.findMany({
        where: { refType: 'Order', refId: order.id },
      });
      expect(ledger).toHaveLength(order.lines.length);
      for (const line of order.lines) {
        expect(ledger.find((entry) => entry.productId === line.productId)).toMatchObject({
          reason: 'ORDER_PLACED',
          delta: -line.qtyOrdered,
        });
      }
    }
  });

  it('gives back exactly what a demo order took when it is cancelled (R4)', async () => {
    await clearDemoOrders();
    execFileSync('npx', ['tsx', 'prisma/seed.ts'], { env: process.env, stdio: 'ignore' });

    const order = await prisma.order.findFirstOrThrow({
      where: { orderNumber: { contains: '-DEMO-' }, status: { not: 'CANCELLED_BY_STORE' } },
      include: { lines: true },
    });
    const manager = await prisma.user.findFirstOrThrow({
      where: { storeId: order.storeId, role: 'STORE_MANAGER' },
    });
    const actor: Principal = {
      kind: 'user',
      userId: manager.id,
      role: 'STORE_MANAGER',
      storeId: order.storeId,
    };

    const before = new Map<string, number>();
    for (const line of order.lines) {
      const item = await prisma.inventoryItem.findFirstOrThrow({
        where: { storeId: order.storeId, productId: line.productId },
      });
      before.set(line.productId, item.websiteStock);
    }

    await correctOrder(actor, order.id, 'demo cancellation');

    // Net zero across the order's whole life: what placement took, cancellation
    // gave back — no more. Before the fix this test would have found the shelf
    // *higher* than the seed's opening balance.
    for (const line of order.lines) {
      const item = await prisma.inventoryItem.findFirstOrThrow({
        where: { storeId: order.storeId, productId: line.productId },
      });
      expect(item.websiteStock).toBe((before.get(line.productId) ?? 0) + line.qtyOrdered);

      const rows = await prisma.stockLedger.findMany({
        where: { refType: 'Order', refId: order.id, productId: line.productId },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((row) => row.reason)).toEqual(['ORDER_PLACED', 'ADMIN_CORRECTION']);
      expect(rows.reduce((sum, row) => sum + row.delta, 0)).toBe(0);
      expect(rows.at(-1)?.balanceAfter).toBe(item.websiteStock);
    }
  });

  it('gives the demo orders a timeline the tracking page can render', async () => {
    await clearDemoOrders();
    execFileSync('npx', ['tsx', 'prisma/seed.ts'], { env: process.env, stdio: 'ignore' });

    const demo = await prisma.order.findMany({
      where: { orderNumber: { contains: '-DEMO-' } },
      include: { statusHistory: true, lines: true },
    });

    expect(demo.length).toBeGreaterThan(0);
    for (const order of demo) {
      expect(order.lines.length).toBeGreaterThan(0);
      expect(order.statusHistory[0]).toMatchObject({ fromStatus: null, toStatus: 'PLACED' });
      expect(order.statusHistory.at(-1)?.toStatus).toBe(order.status);
      expect(order.estimatedTotalPaise).toBe(order.subtotalPaise + order.deliveryFeePaise);
    }
  });
});
