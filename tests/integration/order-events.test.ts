import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { clearEventHandlersForTests, emit, getPrisma, withTransaction } from '@/modules/platform';
import { confirmationDetails, createOrder } from '@/modules/orders';
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

  it('gives the demo orders a timeline the tracking page can render', async () => {
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
