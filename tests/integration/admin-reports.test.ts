import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Prisma, type Principal } from '@/modules/platform';
import { orderCounts, orderQueue, overview } from '@/modules/admin';
import { ORDER_STATUSES, orderCountsForStore } from '@/modules/orders';
import { storeCounts } from '@/modules/stores';
import { createCustomer, createStore, createStoreSettings, createUser } from '../factories/index';

/**
 * Authoritative aggregates for the admin reports and overview screens
 * (`admin-reports-aggregate-query`, OSCAR M1 on PR #43).
 *
 * The reports page used to count `orderQueue({ all: true }).rows` — a list the
 * repository caps at 200 — and called the result the store's total. These
 * reads are real `COUNT … GROUP BY` queries, so the number is exact whatever
 * the row cap, and they are scoped the way every other store read is. The
 * overview's "active stores" counted every store row; `storeCounts` reads
 * `isActive`.
 */
const prisma = getPrisma();

/** More than the queue's row cap, so a capped count is visibly wrong. */
const ORDERS_IN_A = 206;
const userIds: string[] = [];
let storeA: string;
let storeB: string;
let storeDormant: string;
let customerId: string;
let managerA: Principal;
let managerB: Principal;
let superAdmin: Principal;

beforeAll(async () => {
  storeA = (await createStore(prisma)).id;
  await createStoreSettings(prisma, storeA);
  storeB = (await createStore(prisma)).id;
  await createStoreSettings(prisma, storeB);
  storeDormant = (await createStore(prisma, { isActive: false })).id;

  customerId = (await createCustomer(prisma)).id;

  const mA = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeA });
  const mB = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeB });
  const sup = await createUser(prisma, { role: 'SUPER_ADMIN', storeId: null });
  userIds.push(mA.id, mB.id, sup.id);
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
  superAdmin = { kind: 'user', userId: sup.id, role: 'SUPER_ADMIN', storeId: null };

  // Straight into the table: the aggregate is what is under test, not
  // placement, and 206 real checkouts would slow the suite for nothing.
  // Store A: 200 PLACED (10 of them flagged), 4 DELIVERED, 2 CANCELLED_BY_STORE
  // (1 flagged). Store B: 3 PLACED, so a leak from B would change A's number.
  const rows: Prisma.OrderCreateManyInput[] = [];
  const stamp = Date.now().toString(36);
  let n = 0;
  const add = (
    storeId: string,
    status: 'PLACED' | 'DELIVERED' | 'CANCELLED_BY_STORE',
    flagged: boolean,
  ): void => {
    n += 1;
    rows.push({
      orderNumber: `RPT${stamp}-${String(n).padStart(4, '0')}`,
      trackingToken: `rpt-${stamp}-${n}`,
      customerId,
      storeId,
      status,
      priceVarianceFlagged: flagged,
      contactNameSnapshot: 'Report Tester',
      contactPhoneSnapshot: '9000000888',
      deliveryAddressSnapshotJson: { locality: 'Indiranagar' },
      deliverySlotStart: new Date('2026-12-02T10:30:00Z'),
      deliverySlotEnd: new Date('2026-12-02T11:30:00Z'),
      paymentMethod: 'COD',
      subtotalPaise: 9_900,
      deliveryFeePaise: 3_000,
      estimatedTotalPaise: 12_900,
    });
  };
  for (let i = 0; i < 200; i += 1) add(storeA, 'PLACED', i < 10);
  for (let i = 0; i < 4; i += 1) add(storeA, 'DELIVERED', false);
  add(storeA, 'CANCELLED_BY_STORE', true);
  add(storeA, 'CANCELLED_BY_STORE', false);
  for (let i = 0; i < 3; i += 1) add(storeB, 'PLACED', false);
  await prisma.order.createMany({ data: rows });
});

afterAll(async () => {
  const stores = [storeA, storeB, storeDormant];
  await prisma.order.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

describe('order counts are exact, not a capped list', () => {
  it('reports every order in the store, past the queue’s 200-row cap', async () => {
    // The bug OSCAR reproduced: the queue really does stop at 200 …
    const queue = await orderQueue(managerA, storeA, { all: true });
    expect(queue.rows.length).toBe(200);
    // … and the aggregate does not.
    const counts = await orderCounts(managerA, storeA);
    expect(counts.total).toBe(ORDERS_IN_A);
  });

  it('breaks the total down by status, zero-filling statuses with no orders', async () => {
    const counts = await orderCountsForStore(managerA, storeA);
    expect(counts.byStatus).toMatchObject({
      PLACED: 200,
      DELIVERED: 4,
      CANCELLED_BY_STORE: 2,
      ACCEPTED: 0,
      CLOSED_UNDELIVERED: 0,
    });
    expect(Object.keys(counts.byStatus).sort()).toEqual([...ORDER_STATUSES].sort());
    const sum = Object.values(counts.byStatus).reduce((a, b) => a + b, 0);
    expect(sum).toBe(counts.total);
  });

  it('counts price-variance flags, in total and by status', async () => {
    const counts = await orderCountsForStore(managerA, storeA);
    expect(counts.priceVarianceFlagged).toBe(11);
    expect(counts.flaggedByStatus).toMatchObject({
      PLACED: 10,
      CANCELLED_BY_STORE: 1,
      DELIVERED: 0,
    });
  });

  it('is scoped to the store asked for — the other store’s orders never leak in', async () => {
    const b = await orderCountsForStore(managerB, storeB);
    expect(b.total).toBe(3);
    expect(b.byStatus.PLACED).toBe(3);
    expect(b.priceVarianceFlagged).toBe(0);
  });

  it('refuses a manager who asks for the other store', async () => {
    await expect(orderCountsForStore(managerA, storeB)).rejects.toThrow(/permission/i);
    await expect(orderCounts(managerB, storeA)).rejects.toThrow(/permission/i);
  });

  it('lets a super-admin read either store', async () => {
    expect((await orderCountsForStore(superAdmin, storeA)).total).toBe(ORDERS_IN_A);
    expect((await orderCountsForStore(superAdmin, storeB)).total).toBe(3);
  });

  it('is all zeros for a store with no orders, not an error', async () => {
    const counts = await orderCountsForStore(superAdmin, storeDormant);
    expect(counts.total).toBe(0);
    expect(counts.priceVarianceFlagged).toBe(0);
    expect(counts.byStatus.PLACED).toBe(0);
  });
});

describe('store counts know which stores are active', () => {
  it('separates active from inactive for a super-admin', async () => {
    const counts = await storeCounts(superAdmin);
    // Other tests and the seed may own stores too, so compare against the truth.
    const [active, inactive] = await Promise.all([
      prisma.store.count({ where: { isActive: true } }),
      prisma.store.count({ where: { isActive: false } }),
    ]);
    expect(counts).toEqual({ total: active + inactive, active, inactive });
    expect(counts.inactive).toBeGreaterThanOrEqual(1);
  });

  it('is scoped: a manager counts only their own store', async () => {
    expect(await storeCounts(managerA)).toEqual({ total: 1, active: 1, inactive: 0 });
  });

  it('reaches the overview, so the landing screen can stop counting rows', async () => {
    const view = await overview(superAdmin, storeA);
    expect(view.storeCounts).toEqual(await storeCounts(superAdmin));
    expect(view.storeCounts.total).toBe(view.stores.length);
  });
});
