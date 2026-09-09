import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { addItem, ensureCart } from '@/modules/cart';
import { availableSlots, placeOrder } from '@/modules/checkout';
import { slotGridFor } from '@/modules/stores';
import {
  createCategory,
  createDeliveryArea,
  createDeliveryZone,
  createInventoryItem,
  createProduct,
  createStore,
  createStoreProduct,
  createStoreSettings,
} from '../factories/index';

/**
 * P4-3 — delivery slots, and the one gate that has to be right.
 *
 * `availableSlots` is a convenience: it can be stale, and saying so is part of
 * the design. The **capacity gate inside `placeOrder`** is not, and the test
 * that matters here is the last one: many shoppers, one small window, exactly as
 * many orders as the window holds.
 */
const prisma = getPrisma();

let storeId: string;
let areaId: string;
let categoryId: string;
let productId: string;
const cartTokens: string[] = [];

/** Placing an order: the store is resolved from the address, so no context yet. */
const guest: Principal = { kind: 'customer', customerId: null, storeId: null };
/**
 * Reading the slot picker: a shopper who has already chosen a delivery area, so
 * their principal is bound to that store. A visitor with no store context cannot
 * read a store's settings at all, which is the `allowedStoreIds` rule doing its
 * job rather than a gap.
 */
let bound: Principal;
/** Far enough ahead to clear the lead time, on the IST hourly grid. */
const NOW = new Date('2026-12-01T06:00:00Z');

beforeAll(async () => {
  categoryId = (await createCategory(prisma)).id;
  const store = await createStore(prisma, { timezone: 'Asia/Kolkata' });
  storeId = store.id;
  await createStoreSettings(prisma, storeId, {
    minOrderPaise: 0,
    deliveryFeePaise: 0,
    slotLengthMinutes: 60,
    slotCapacity: 3,
  });

  const product = await createProduct(prisma, { categoryId });
  productId = product.id;
  await createStoreProduct(prisma, storeId, productId, {
    sellingPricePaise: 5_000,
    isListed: true,
  });
  await createInventoryItem(prisma, storeId, productId, { websiteStock: 500 });

  const zone = await createDeliveryZone(prisma, storeId);
  areaId = (await createDeliveryArea(prisma, zone.id, { name: 'Slot Area' })).id;

  bound = { kind: 'customer', customerId: null, storeId };
});

afterAll(async () => {
  await prisma.orderStatusHistory.deleteMany({ where: { order: { storeId } } });
  await prisma.orderLine.deleteMany({ where: { order: { storeId } } });
  await prisma.order.deleteMany({ where: { storeId } });
  await prisma.cartItem.deleteMany({ where: { cart: { cartToken: { in: cartTokens } } } });
  await prisma.cart.deleteMany({ where: { cartToken: { in: cartTokens } } });
  await prisma.deliveryArea.deleteMany({ where: { zone: { storeId } } });
  await prisma.deliveryZone.deleteMany({ where: { storeId } });
  await prisma.stockLedger.deleteMany({ where: { storeId } });
  await prisma.inventoryItem.deleteMany({ where: { storeId } });
  await prisma.storeProduct.deleteMany({ where: { storeId } });
  await prisma.customer.deleteMany({ where: { phone: { startsWith: '97000' } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.$disconnect();
});

async function basket(qty = 1): Promise<string> {
  const shopper: Principal = { kind: 'customer', customerId: null, storeId };
  const { cart } = await ensureCart(storeId, null);
  cartTokens.push(cart.cartToken);
  await addItem(shopper, { cartToken: cart.cartToken, storeId, productId, qty });
  return cart.cartToken;
}

function order(cartToken: string, slotStart: Date, phone: string) {
  return {
    cartToken,
    contact: { name: 'Slot Tester', phone },
    addressInput: { areaId },
    slotStart,
    paymentMethod: 'COD',
    now: NOW,
  };
}

describe('availableSlots', () => {
  it('offers hourly windows on the hour in the store’s timezone', async () => {
    const slots = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });

    expect(slots.length).toBeGreaterThan(0);
    for (const slot of slots) {
      expect(slot.end.getTime() - slot.start.getTime()).toBe(60 * 60 * 1000);
      // On the hour in IST (UTC+5:30).
      expect((slot.start.getTime() + 5.5 * 3_600_000) % 3_600_000).toBe(0);
    }
  });

  it('starts no sooner than the lead time and stops at the horizon', async () => {
    const slots = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });

    expect(slots[0]!.start.getTime()).toBeGreaterThanOrEqual(NOW.getTime() + 120 * 60_000);
    expect(slots.at(-1)!.start.getTime()).toBeLessThanOrEqual(NOW.getTime() + 86_400_000);
  });

  it('reports full capacity before anyone has ordered', async () => {
    const slots = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
    expect(slots.every((slot) => slot.capacityRemaining === 3)).toBe(true);
  });

  it('counts a placed order against its window, and only that window', async () => {
    const slots = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
    const target = slots[0]!.start;

    await placeOrder(guest, order(await basket(), target, '9700000001'));

    const after = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
    expect(after.find((slot) => slot.start.getTime() === target.getTime())?.capacityRemaining).toBe(
      2,
    );
    expect(after.filter((slot) => slot.capacityRemaining !== 3)).toHaveLength(1);
  });

  it('gives a cancelled order’s place back', async () => {
    const slots = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
    const target = slots[1]!.start;
    const placed = await placeOrder(guest, order(await basket(), target, '9700000002'));

    const before = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
    expect(
      before.find((slot) => slot.start.getTime() === target.getTime())?.capacityRemaining,
    ).toBe(2);

    await prisma.order.update({
      where: { id: placed.orderId },
      data: { status: 'CANCELLED_BY_STORE' },
    });

    const after = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
    expect(after.find((slot) => slot.start.getTime() === target.getTime())?.capacityRemaining).toBe(
      3,
    );
  });

  it('offers nothing at all while the shop is not taking orders', async () => {
    await prisma.storeSettings.updateMany({
      where: { storeId },
      data: { isAcceptingOrders: false },
    });
    try {
      expect(await availableSlots(bound, storeId, NOW, { horizonDays: 1 })).toEqual([]);
      expect((await slotGridFor(bound, storeId, NOW)).starts).toEqual([]);
    } finally {
      await prisma.storeSettings.updateMany({
        where: { storeId },
        data: { isAcceptingOrders: true },
      });
    }
  });

  it('follows a store that changes its slot length', async () => {
    await prisma.storeSettings.updateMany({ where: { storeId }, data: { slotLengthMinutes: 30 } });
    try {
      const slots = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
      expect(slots[0]!.end.getTime() - slots[0]!.start.getTime()).toBe(30 * 60 * 1000);
    } finally {
      await prisma.storeSettings.updateMany({
        where: { storeId },
        data: { slotLengthMinutes: 60 },
      });
    }
  });
});

describe('the capacity gate in placeOrder', () => {
  it('refuses a slot outside the offered grid', async () => {
    const token = await basket();
    // Inside the lead time.
    await expect(
      placeOrder(guest, order(token, new Date('2026-12-01T06:30:00Z'), '9700000003')),
    ).rejects.toThrow(/not available/i);
    // Beyond the horizon.
    await expect(
      placeOrder(guest, order(token, new Date('2026-12-20T08:30:00Z'), '9700000003')),
    ).rejects.toThrow(/not available/i);
    // Off the grid.
    await expect(
      placeOrder(guest, order(token, new Date('2026-12-01T08:45:00Z'), '9700000003')),
    ).rejects.toThrow(/not available/i);
  });

  it('refuses once the window is full, and says so', async () => {
    const slots = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
    const target = slots[2]!.start;

    for (let i = 0; i < 3; i += 1) {
      await placeOrder(guest, order(await basket(), target, `970000010${i}`));
    }

    const token = await basket();
    await expect(placeOrder(guest, order(token, target, '9700000109'))).rejects.toThrow(/full/i);

    expect(
      (await availableSlots(bound, storeId, NOW, { horizonDays: 1 })).find(
        (slot) => slot.start.getTime() === target.getTime(),
      )?.capacityRemaining,
    ).toBe(0);
    // The refused shopper's basket is untouched and their stock was not taken.
    expect((await prisma.cart.findUniqueOrThrow({ where: { cartToken: token } })).status).toBe(
      'ACTIVE',
    );
  });

  /** The test this whole deliverable exists for. */
  it('lets exactly C of N simultaneous shoppers into a capacity-C window', async () => {
    const CAPACITY = 3;
    const SHOPPERS = 12;

    const slots = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
    const target = slots[3]!.start;

    const tokens: string[] = [];
    for (let i = 0; i < SHOPPERS; i += 1) tokens.push(await basket());

    const results = await Promise.allSettled(
      tokens.map((token, index) =>
        placeOrder(guest, order(token, target, `97000002${String(index).padStart(2, '0')}`)),
      ),
    );

    const placed = results.filter((result) => result.status === 'fulfilled');
    const refused = results.filter((result) => result.status === 'rejected');

    expect(placed).toHaveLength(CAPACITY);
    expect(refused).toHaveLength(SHOPPERS - CAPACITY);
    for (const rejection of refused) {
      expect((rejection).reason).toMatchObject({
        details: { reason: 'slot-full' },
      });
    }

    // The database agrees, which is the assertion that would catch a gate that
    // let one extra through under a different interleaving.
    expect(await prisma.order.count({ where: { storeId, deliverySlotStart: target } })).toBe(
      CAPACITY,
    );
  });

  it('does not let one window’s traffic block another', async () => {
    const slots = await availableSlots(bound, storeId, NOW, { horizonDays: 1 });
    const [first, second] = [slots[4]!.start, slots[5]!.start];

    const results = await Promise.allSettled([
      placeOrder(guest, order(await basket(), first, '9700000301')),
      placeOrder(guest, order(await basket(), second, '9700000302')),
    ]);

    expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
  });
});
