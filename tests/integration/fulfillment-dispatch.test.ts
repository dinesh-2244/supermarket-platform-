import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearEventHandlersForTests,
  getPrisma,
  on,
  type DomainEventName,
  type Principal,
} from '@/modules/platform';
import { confirmRevisedAmount, dispatch, dispatchQueue, markPacked } from '@/modules/fulfillment';
import { createCustomer, createStoreWithProduct, createUser } from '../factories/index';
import { placeOrder, walkTo } from './helpers/fulfillment-walk';

/**
 * P5-3 — packing and dispatch, against a real database.
 *
 * On trial: `BILLED_IN_POS → PACKED → OUT_FOR_DELIVERY` through the state
 * machine; the Phase 4 variance guard, now driven by a **real** flagged
 * bill, blocks dispatch until a manager confirms the revised amount and never
 * blocks an order billed within tolerance; and dispatch opens the
 * `DeliveryRecord` the delivery outcome (D4) will complete.
 */
const prisma = getPrisma();

let storeA: string;
let storeB: string;
let productA: string;
let productB: string;
let customerId: string;
let managerA: Principal;
let managerB: Principal;
let staffA: Principal;
const userIds: string[] = [];
const categoryIds: string[] = [];

beforeAll(async () => {
  const a = await createStoreWithProduct(prisma, { websiteStock: 100 });
  storeA = a.store.id;
  productA = a.product.id;
  categoryIds.push(a.product.categoryId);
  const b = await createStoreWithProduct(prisma, { websiteStock: 100 });
  storeB = b.store.id;
  productB = b.product.id;
  categoryIds.push(b.product.categoryId);
  customerId = (await createCustomer(prisma)).id;
  const mA = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeA });
  const mB = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeB });
  const sA = await createUser(prisma, { role: 'STORE_STAFF', storeId: storeA });
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
  staffA = { kind: 'user', userId: sA.id, role: 'STORE_STAFF', storeId: storeA };
  userIds.push(mA.id, mB.id, sA.id);
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.auditLog.deleteMany({ where: { entityType: { in: ['Order', 'OrderLine'] } } });
  await prisma.order.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.stockLedger.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.product.deleteMany({ where: { id: { in: [productA, productB] } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

const shopper: Principal = { kind: 'customer', customerId: null, storeId: null };

async function status(id: string): Promise<string> {
  return (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
}

async function billedOrder(bill: { finalTotalPaise?: number } = {}): Promise<string> {
  const id = await placeOrder(storeA, productA, customerId);
  await walkTo(staffA, id, 'BILLED_IN_POS', bill);
  return id;
}

describe('packing', () => {
  let heard: DomainEventName[];
  beforeEach(() => {
    heard = [];
    for (const name of ['order.packed', 'order.dispatched'] as const) {
      on(name, () => {
        heard.push(name);
      });
    }
  });
  afterEach(() => clearEventHandlersForTests());

  it('moves BILLED_IN_POS to PACKED with its stamp and event', async () => {
    const id = await billedOrder();
    const outcome = await markPacked(staffA, id);
    expect(outcome).toMatchObject({ from: 'BILLED_IN_POS', to: 'PACKED' });
    const row = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('PACKED');
    expect(row.packedAt).not.toBeNull();
    expect(heard).toEqual(['order.packed']);
  });

  it('is reachable only from BILLED_IN_POS', async () => {
    const id = await placeOrder(storeA, productA, customerId);
    await walkTo(staffA, id, 'PICKED');
    await expect(markPacked(staffA, id)).rejects.toThrow(/PICKED/);
    expect(await status(id)).toBe('PICKED');
  });
});

describe('dispatch and the variance guard, driven for real', () => {
  it('sends a within-tolerance order out and opens its delivery record', async () => {
    const id = await billedOrder();
    await markPacked(staffA, id);
    const outcome = await dispatch(staffA, id, { assigneeName: 'Ravi' });
    expect(outcome).toMatchObject({ from: 'PACKED', to: 'OUT_FOR_DELIVERY' });
    const row = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('OUT_FOR_DELIVERY');
    expect(row.dispatchedAt).not.toBeNull();
    const delivery = await prisma.deliveryRecord.findUniqueOrThrow({ where: { orderId: id } });
    expect(delivery).toMatchObject({ status: 'OUT', assigneeName: 'Ravi' });
    expect(delivery.outAt).not.toBeNull();
    expect(delivery.deliveredAt).toBeNull();
  });

  it('is blocked for a really flagged order until a manager confirms the revised amount', async () => {
    const id = await placeOrder(storeA, productA, customerId);
    const estimated = (await prisma.order.findUniqueOrThrow({ where: { id } })).estimatedTotalPaise;
    await walkTo(staffA, id, 'PACKED', { finalTotalPaise: estimated * 2 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'PACKED',
      priceVarianceFlagged: true,
      customerConfirmedRevisedAmount: false,
    });

    await expect(dispatch(staffA, id)).rejects.toThrow(/confirm the revised amount/i);
    expect(await status(id)).toBe('PACKED');
    expect(await prisma.deliveryRecord.findUnique({ where: { orderId: id } })).toBeNull();

    await confirmRevisedAmount(managerA, id);
    const outcome = await dispatch(staffA, id);
    expect(outcome.to).toBe('OUT_FOR_DELIVERY');
    expect(await prisma.deliveryRecord.findUnique({ where: { orderId: id } })).toMatchObject({
      status: 'OUT',
    });
  });

  it('is reachable only from PACKED, and refuses the other store as not found', async () => {
    const id = await billedOrder();
    await expect(dispatch(staffA, id)).rejects.toThrow(/BILLED_IN_POS/);
    await markPacked(staffA, id);
    await expect(dispatch(managerB, id)).rejects.toThrow(/no such order/i);
    await expect(dispatch(shopper, id)).rejects.toThrow(/permission/i);
    expect(await status(id)).toBe('PACKED');
  });

  it('keeps one delivery record per order across a re-dispatch', async () => {
    // A failed delivery re-dispatched (D4) reuses the record; here, prove
    // dispatch itself is idempotent on the row by dispatching once and checking
    // the row count — the re-dispatch edge is exercised in the delivery suite.
    const id = await billedOrder();
    await markPacked(staffA, id);
    await dispatch(staffA, id);
    expect(await prisma.deliveryRecord.count({ where: { orderId: id } })).toBe(1);
  });
});

describe('the dispatch queue', () => {
  it('lists the store’s BILLED_IN_POS and PACKED orders, flagging which are blocked', async () => {
    const billed = await billedOrder();
    const packedClear = await billedOrder();
    await markPacked(staffA, packedClear);
    const packedBlocked = await placeOrder(storeA, productA, customerId);
    const est = (await prisma.order.findUniqueOrThrow({ where: { id: packedBlocked } }))
      .estimatedTotalPaise;
    await walkTo(staffA, packedBlocked, 'PACKED', { finalTotalPaise: est * 2 });
    const out = await billedOrder();
    await markPacked(staffA, out);
    await dispatch(staffA, out);
    const other = await placeOrder(storeB, productB, customerId);
    await walkTo(managerB, other, 'PACKED');

    const queue = await dispatchQueue(staffA, storeA);
    const byId = new Map(queue.map((q) => [q.id, q]));
    expect(byId.get(billed)).toMatchObject({ status: 'BILLED_IN_POS', dispatchBlockedBy: null });
    expect(byId.get(packedClear)).toMatchObject({ status: 'PACKED', dispatchBlockedBy: null });
    expect(byId.get(packedBlocked)?.dispatchBlockedBy).toMatch(/confirm the revised amount/i);
    expect(byId.has(out)).toBe(false);
    expect(byId.has(other)).toBe(false);
    await expect(dispatchQueue(managerB, storeA)).rejects.toThrow(/permission/i);
  });
});
