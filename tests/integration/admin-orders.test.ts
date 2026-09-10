import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, withTransaction, type Principal } from '@/modules/platform';
import { ACTIONABLE_ORDER_STATUSES, orderDetail, orderQueue } from '@/modules/admin';
import { applyTransition, confirmRevisedAmount, correctOrder, createOrder } from '@/modules/orders';
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
 * P4-6 — the back-office order screens.
 *
 * The read model is thin by design, so what is actually on trial is the
 * scoping: a manager must not see, open or correct the other store's order, and
 * a staff member must not correct anything at all.
 */
const prisma = getPrisma();

let storeA: string;
let storeB: string;
let categoryId: string;
let productA: string;
let productB: string;
let customerId: string;
let managerA: Principal;
let managerB: Principal;
let staffA: Principal;
let superAdmin: Principal;
const userIds: string[] = [];

beforeAll(async () => {
  categoryId = (await createCategory(prisma)).id;

  const first = await createStore(prisma);
  storeA = first.id;
  await createStoreSettings(prisma, storeA);
  const second = await createStore(prisma);
  storeB = second.id;
  await createStoreSettings(prisma, storeB);

  productA = (await createProduct(prisma, { categoryId })).id;
  productB = (await createProduct(prisma, { categoryId })).id;
  await createStoreProduct(prisma, storeA, productA, { sellingPricePaise: 9_900 });
  await createStoreProduct(prisma, storeB, productB, { sellingPricePaise: 9_900 });
  await createInventoryItem(prisma, storeA, productA, { websiteStock: 100 });
  await createInventoryItem(prisma, storeB, productB, { websiteStock: 100 });

  customerId = (await createCustomer(prisma)).id;

  const mA = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeA });
  const mB = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeB });
  const sA = await createUser(prisma, { role: 'STORE_STAFF', storeId: storeA });
  const sup = await createUser(prisma, { role: 'SUPER_ADMIN', storeId: null });
  userIds.push(mA.id, mB.id, sA.id, sup.id);
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
  staffA = { kind: 'user', userId: sA.id, role: 'STORE_STAFF', storeId: storeA };
  superAdmin = { kind: 'user', userId: sup.id, role: 'SUPER_ADMIN', storeId: null };
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.auditLog.deleteMany({ where: { entityType: 'Order' } });
  await prisma.order.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.stockLedger.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.product.deleteMany({ where: { id: { in: [productA, productB] } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

async function place(storeId: string, productId: string, qty = 2): Promise<string> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  return withTransaction(async (tx) => {
    const created = await createOrder(tx, {
      storeCode: store.code,
      customerId,
      storeId,
      contactName: 'Queue Tester',
      contactPhone: '9000000777',
      deliveryAddressSnapshot: { locality: 'Indiranagar' },
      deliverySlotStart: new Date('2026-12-01T10:30:00Z'),
      deliverySlotEnd: new Date('2026-12-01T11:30:00Z'),
      paymentMethod: 'COD',
      subtotalPaise: 9_900 * qty,
      deliveryFeePaise: 3_000,
      lines: [
        {
          productId,
          nameSnapshot: 'Queue Rice',
          packSizeSnapshot: '1 kg',
          unitPricePaise: 9_900,
          qtyOrdered: qty,
        },
      ],
    });
    return created.id;
  });
}

describe('the queue is store-scoped', () => {
  it('shows a manager their own store’s orders and not the other’s', async () => {
    const mine = await place(storeA, productA);
    const theirs = await place(storeB, productB);

    const queue = await orderQueue(managerA, storeA);
    const ids = queue.rows.map((row) => row.id);

    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it('refuses a manager who asks for the other store outright', async () => {
    await expect(orderQueue(managerA, storeB)).rejects.toThrow(/permission/i);
  });

  it('lets staff read their own store’s queue', async () => {
    const queue = await orderQueue(staffA, storeA);
    expect(queue.rows.length).toBeGreaterThan(0);
  });

  it('lets a super-admin read either store', async () => {
    expect((await orderQueue(superAdmin, storeA)).rows.length).toBeGreaterThan(0);
    expect((await orderQueue(superAdmin, storeB)).rows.length).toBeGreaterThan(0);
  });

  it('hides finished orders by default and shows them on request', async () => {
    const done = await place(storeA, productA);
    for (const to of ['ACCEPTED', 'PICKING', 'PICKED', 'BILLED_IN_POS', 'PACKED'] as const) {
      await applyTransition(managerA, done, to);
    }
    await applyTransition(managerA, done, 'OUT_FOR_DELIVERY');
    await applyTransition(managerA, done, 'DELIVERED');
    await applyTransition(managerA, done, 'CLOSED');

    const actionable = await orderQueue(managerA, storeA);
    expect(actionable.rows.map((row) => row.id)).not.toContain(done);
    expect(actionable.showingAll).toBe(false);
    for (const row of actionable.rows) {
      expect(ACTIONABLE_ORDER_STATUSES).toContain(row.status);
    }

    const all = await orderQueue(managerA, storeA, { all: true });
    expect(all.rows.map((row) => row.id)).toContain(done);
    expect(all.showingAll).toBe(true);
  });
});

describe('the detail read', () => {
  it('returns the order with its lines and history', async () => {
    const id = await place(storeA, productA, 3);
    await applyTransition(managerA, id, 'ACCEPTED', 'confirmed by phone');

    const order = await orderDetail(managerA, id);
    expect(order).toMatchObject({ status: 'ACCEPTED', storeId: storeA });
    expect(order?.lines).toHaveLength(1);
    expect(order?.lines[0]).toMatchObject({ qtyOrdered: 3, stockRestoredQty: 0 });
    expect(order?.statusHistory.map((entry) => entry.toStatus)).toEqual(['PLACED', 'ACCEPTED']);
    expect(order?.statusHistory.at(-1)?.note).toBe('confirmed by phone');
  });

  it('is *not found*, not forbidden, for the other store’s order', async () => {
    // Telling somebody an order exists but is not theirs is itself a
    // disclosure, and there is nothing they could do with the distinction.
    const theirs = await place(storeB, productB);
    expect(await orderDetail(managerA, theirs)).toBeNull();
    expect(await orderDetail(staffA, theirs)).toBeNull();
  });

  it('is null for an id that does not exist at all', async () => {
    expect(await orderDetail(managerA, '00000000-0000-4000-8000-000000000000')).toBeNull();
  });
});

describe('the audited correction', () => {
  async function stockOf(storeId: string, productId: string): Promise<number> {
    return (await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } }))
      .websiteStock;
  }

  it('restores the not-yet-restored units and writes an audit row', async () => {
    const id = await place(storeA, productA, 4);
    const before = await stockOf(storeA, productA);

    const result = await correctOrder(managerA, id, 'customer unreachable');

    expect(result.restored).toEqual([{ productId: productA, qty: 4, balanceAfter: before + 4 }]);
    expect(await stockOf(storeA, productA)).toBe(before + 4);

    const detail = await orderDetail(managerA, id);
    expect(detail?.status).toBe('CANCELLED_BY_STORE');
    expect(detail?.correctionReason).toBe('customer unreachable');
    expect(detail?.lines[0]?.stockRestoredQty).toBe(4);

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Order', entityId: id } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ storeId: storeA, action: 'update' });
  });

  it('never restores a unit twice, even after a short-pick restore', async () => {
    const id = await place(storeA, productA, 6);
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } });
    await prisma.orderLine.update({ where: { id: line.id }, data: { stockRestoredQty: 4 } });

    const before = await stockOf(storeA, productA);
    const result = await correctOrder(managerA, id, 'short picked');

    expect(result.restored).toEqual([{ productId: productA, qty: 2, balanceAfter: before + 2 }]);
    expect(
      (await prisma.orderLine.findUniqueOrThrow({ where: { id: line.id } })).stockRestoredQty,
    ).toBe(6);
  });

  it('refuses staff, and refuses the other store’s manager', async () => {
    const id = await place(storeA, productA, 2);
    const before = await stockOf(storeA, productA);

    await expect(correctOrder(staffA, id, 'not my call')).rejects.toThrow(/permission/i);
    await expect(correctOrder(managerB, id, 'not my store')).rejects.toThrow(/permission/i);

    expect(await stockOf(storeA, productA)).toBe(before);
    expect((await orderDetail(managerA, id))?.status).toBe('PLACED');
  });

  it('refuses a blank reason', async () => {
    const id = await place(storeA, productA, 1);
    await expect(correctOrder(managerA, id, '   ')).rejects.toThrow(/needs a reason/i);
  });
});

describe('confirming a revised amount', () => {
  it('opens the PACKED gate that the variance closed', async () => {
    const id = await place(storeA, productA, 2);
    for (const to of ['ACCEPTED', 'PICKING', 'PICKED', 'BILLED_IN_POS', 'PACKED'] as const) {
      await applyTransition(managerA, id, to);
    }
    // Phase 5 sets this from a real POS total; here it is set directly.
    await prisma.order.update({
      where: { id },
      data: { priceVarianceFlagged: true, posFinalTotalPaise: 99_999 },
    });

    await expect(applyTransition(managerA, id, 'OUT_FOR_DELIVERY')).rejects.toThrow(
      /confirm the revised amount/i,
    );

    await confirmRevisedAmount(managerA, id);

    const detail = await orderDetail(managerA, id);
    expect(detail?.customerConfirmedRevisedAmount).toBe(true);
    expect(detail?.revisedAmountConfirmedBy).toBe(
      managerA.kind === 'user' ? managerA.userId : null,
    );

    await applyTransition(managerA, id, 'OUT_FOR_DELIVERY');
    expect((await orderDetail(managerA, id))?.status).toBe('OUT_FOR_DELIVERY');
  });

  it('writes an audit row naming who confirmed', async () => {
    const id = await place(storeA, productA, 1);
    await prisma.order.update({ where: { id }, data: { priceVarianceFlagged: true } });
    await confirmRevisedAmount(managerA, id);

    const audit = await prisma.auditLog.findMany({ where: { entityType: 'Order', entityId: id } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.afterJson)).toContain('customerConfirmedRevisedAmount');
  });

  it('refuses staff and the other store’s manager', async () => {
    const id = await place(storeA, productA, 1);
    await prisma.order.update({ where: { id }, data: { priceVarianceFlagged: true } });

    await expect(confirmRevisedAmount(staffA, id)).rejects.toThrow(/permission/i);
    await expect(confirmRevisedAmount(managerB, id)).rejects.toThrow(/permission/i);
    expect((await orderDetail(managerA, id))?.customerConfirmedRevisedAmount).toBe(false);
  });

  it('refuses when there is no variance to confirm', async () => {
    const id = await place(storeA, productA, 1);
    await expect(confirmRevisedAmount(managerA, id)).rejects.toThrow(/no price variance/i);
  });
});
