import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearEventHandlersForTests,
  getPrisma,
  on,
  withTransaction,
  type Principal,
} from '@/modules/platform';
import { applyMovement } from '@/modules/inventory';
import { computeVariance, createOrder, type NewOrderLine } from '@/modules/orders';
import {
  acceptOrder,
  billingQueue,
  completePicking,
  confirmRevisedAmount,
  recordFinalBill,
  recordLinePick,
  startPicking,
} from '@/modules/fulfillment';
import { createCustomer, createStoreWithProduct, createUser } from '../factories/index';

/**
 * P5-2 — the manual POS billing handoff, against a real database.
 *
 * On trial: a bill is recorded once per order and only from `PICKED`; the
 * variance flag is exactly what `computeVariance` says at the store's own
 * threshold, on either side of it; the handoff row, the order's POS fields
 * and the transition land together; and the first *real* flagged order can
 * be confirmed the way Phase 4 promised.
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
let staffUserId: string;
const userIds: string[] = [];
const categoryIds: string[] = [];

/** The store's thresholds, as `createStoreSettings` sets them. */
let percentBp: number;
let absCapPaise: number;

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

  const settings = await prisma.storeSettings.findUniqueOrThrow({ where: { storeId: storeA } });
  percentBp = settings.priceVariancePercentBp;
  absCapPaise = settings.priceVarianceAbsCapPaise;

  const mA = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeA });
  const mB = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeB });
  const sA = await createUser(prisma, { role: 'STORE_STAFF', storeId: storeA });
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
  staffA = { kind: 'user', userId: sA.id, role: 'STORE_STAFF', storeId: storeA };
  staffUserId = sA.id;
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
const UNIT = 12_500;
const FEE = 3_000;

async function placeOrder(storeId: string, productId: string, qty = 2): Promise<string> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const lines: NewOrderLine[] = [
    {
      productId,
      nameSnapshot: 'Test Product',
      packSizeSnapshot: '1 kg',
      unitPricePaise: UNIT,
      qtyOrdered: qty,
    },
  ];
  return withTransaction(async (tx) => {
    await applyMovement(tx, shopper, { storeId, productId, delta: -qty, reason: 'ORDER_PLACED' });
    const created = await createOrder(tx, {
      storeCode: store.code,
      customerId,
      storeId,
      contactName: 'Asha',
      contactPhone: '9000000001',
      deliveryAddressSnapshot: { line1: '1 Test Street', pincode: '560001' },
      deliverySlotStart: new Date('2026-03-01T10:00:00Z'),
      deliverySlotEnd: new Date('2026-03-01T11:00:00Z'),
      paymentMethod: 'COD',
      subtotalPaise: UNIT * qty,
      deliveryFeePaise: FEE,
      lines,
    });
    return created.id;
  });
}

/** An order at PICKED, with every line picked in full. */
async function pickedOrder(
  storeId = storeA,
  productId = productA,
  actor = staffA,
): Promise<string> {
  const id = await placeOrder(storeId, productId);
  await acceptOrder(actor, id);
  await startPicking(actor, id);
  const lines = await prisma.orderLine.findMany({ where: { orderId: id } });
  for (const line of lines) {
    await recordLinePick(actor, id, line.id, { outcome: 'PICKED', qtyPicked: line.qtyOrdered });
  }
  await completePicking(actor, id);
  return id;
}

async function order(id: string) {
  return prisma.order.findUniqueOrThrow({ where: { id } });
}

describe('recording the final bill', () => {
  let billed: { orderId: string; priceVarianceFlagged: boolean }[];
  beforeEach(() => {
    billed = [];
    on('order.billed', (payload) => {
      billed.push(payload);
    });
  });
  afterEach(() => clearEventHandlersForTests());

  it('writes the handoff, the order’s POS fields and the transition together, and announces it', async () => {
    const id = await pickedOrder();
    const estimated = (await order(id)).estimatedTotalPaise;
    expect(estimated).toBe(UNIT * 2 + FEE);

    const result = await recordFinalBill(staffA, id, {
      billNumber: 'POS-1001',
      finalTotalPaise: estimated,
    });
    expect(result.outcome).toMatchObject({ from: 'PICKED', to: 'BILLED_IN_POS' });
    expect(result.variance).toEqual(
      computeVariance({
        estimatedTotalPaise: estimated,
        posFinalTotalPaise: estimated,
        percentBp,
        absCapPaise,
      }),
    );
    expect(result.variance.flagged).toBe(false);

    const row = await order(id);
    expect(row).toMatchObject({
      status: 'BILLED_IN_POS',
      posBillNumber: 'POS-1001',
      posFinalTotalPaise: estimated,
      priceVarianceFlagged: false,
    });
    expect(row.billedAt).not.toBeNull();
    const handoff = await prisma.posBillingHandoff.findUniqueOrThrow({ where: { orderId: id } });
    expect(handoff).toMatchObject({
      posBillNumber: 'POS-1001',
      posFinalTotalPaise: estimated,
      billedByUserId: staffUserId,
      discrepancyNote: null,
    });
    expect(billed).toEqual([{ orderId: id, priceVarianceFlagged: false }]);
  });

  it('flags the variance exactly at the store’s threshold — one paise over, not at it', async () => {
    const atThreshold = await pickedOrder();
    const estimated = (await order(atThreshold)).estimatedTotalPaise;
    const threshold = computeVariance({
      estimatedTotalPaise: estimated,
      posFinalTotalPaise: estimated,
      percentBp,
      absCapPaise,
    }).thresholdPaise;
    expect(threshold).toBeGreaterThan(0);

    const exactly = await recordFinalBill(staffA, atThreshold, {
      billNumber: 'POS-AT',
      finalTotalPaise: estimated + threshold,
    });
    expect(exactly.variance).toMatchObject({ overagePaise: threshold, flagged: false });
    expect((await order(atThreshold)).priceVarianceFlagged).toBe(false);

    const overThreshold = await pickedOrder();
    const over = await recordFinalBill(staffA, overThreshold, {
      billNumber: 'POS-OVER',
      finalTotalPaise: estimated + threshold + 1,
      discrepancyNote: 'Weighed items came in heavier',
    });
    expect(over.variance).toMatchObject({ overagePaise: threshold + 1, flagged: true });
    expect((await order(overThreshold)).priceVarianceFlagged).toBe(true);
    const handoff = await prisma.posBillingHandoff.findUniqueOrThrow({
      where: { orderId: overThreshold },
    });
    expect(handoff.discrepancyNote).toBe('Weighed items came in heavier');
    expect(billed).toEqual([
      { orderId: atThreshold, priceVarianceFlagged: false },
      { orderId: overThreshold, priceVarianceFlagged: true },
    ]);
  });

  it('a bill under the estimate is never a variance', async () => {
    const id = await pickedOrder();
    const estimated = (await order(id)).estimatedTotalPaise;
    const result = await recordFinalBill(staffA, id, {
      billNumber: 'POS-UNDER',
      finalTotalPaise: estimated - 5_000,
    });
    expect(result.variance).toMatchObject({ overagePaise: 0, flagged: false });
  });

  it('is recorded once — a second bill is refused and nothing changes', async () => {
    const id = await pickedOrder();
    await recordFinalBill(staffA, id, { billNumber: 'POS-1', finalTotalPaise: 1_000 });
    await expect(
      recordFinalBill(staffA, id, { billNumber: 'POS-2', finalTotalPaise: 2_000 }),
    ).rejects.toThrow(/BILLED_IN_POS/);
    expect(await order(id)).toMatchObject({ posBillNumber: 'POS-1', posFinalTotalPaise: 1_000 });
    expect(await prisma.posBillingHandoff.count({ where: { orderId: id } })).toBe(1);
  });

  it('is reachable only from PICKED', async () => {
    const id = await placeOrder(storeA, productA);
    await expect(
      recordFinalBill(staffA, id, { billNumber: 'POS-EARLY', finalTotalPaise: 1 }),
    ).rejects.toThrow(/PLACED/);
    expect(await prisma.posBillingHandoff.count({ where: { orderId: id } })).toBe(0);
    expect((await order(id)).posBillNumber).toBeNull();
  });

  it('refuses a blank bill number before touching anything', async () => {
    const id = await pickedOrder();
    await expect(
      recordFinalBill(staffA, id, { billNumber: ' ', finalTotalPaise: 1 }),
    ).rejects.toThrow(/bill number/i);
    expect((await order(id)).status).toBe('PICKED');
  });

  it('refuses a shopper, and the other store’s manager as not found', async () => {
    const id = await pickedOrder();
    await expect(
      recordFinalBill(shopper, id, { billNumber: 'POS-X', finalTotalPaise: 1 }),
    ).rejects.toThrow(/permission/i);
    await expect(
      recordFinalBill(managerB, id, { billNumber: 'POS-X', finalTotalPaise: 1 }),
    ).rejects.toThrow(/no such order/i);
    expect((await order(id)).status).toBe('PICKED');
  });

  it('refuses a store whose POS mode is ADAPTER — no vendor is integrated', async () => {
    const id = await pickedOrder();
    await prisma.storeSettings.update({ where: { storeId: storeA }, data: { posMode: 'ADAPTER' } });
    try {
      await expect(
        recordFinalBill(staffA, id, { billNumber: 'POS-X', finalTotalPaise: 1 }),
      ).rejects.toThrow(/no POS vendor/i);
      expect((await order(id)).status).toBe('PICKED');
    } finally {
      await prisma.storeSettings.update({
        where: { storeId: storeA },
        data: { posMode: 'MANUAL' },
      });
    }
  });
});

describe('confirming a real flagged variance', () => {
  it('records the confirmation on a genuinely flagged order, by a manager', async () => {
    const id = await pickedOrder();
    const estimated = (await order(id)).estimatedTotalPaise;
    await recordFinalBill(staffA, id, { billNumber: 'POS-BIG', finalTotalPaise: estimated * 2 });
    expect((await order(id)).priceVarianceFlagged).toBe(true);

    await expect(confirmRevisedAmount(staffA, id)).rejects.toThrow(/permission/i);
    await confirmRevisedAmount(managerA, id);
    expect(await order(id)).toMatchObject({
      customerConfirmedRevisedAmount: true,
      revisedAmountConfirmedBy: managerA.kind === 'user' ? managerA.userId : null,
    });
  });
});

describe('the billing queue', () => {
  it('lists the store’s PICKED orders and nothing else', async () => {
    const picked = await pickedOrder();
    const billed = await pickedOrder();
    await recordFinalBill(staffA, billed, { billNumber: 'POS-Q', finalTotalPaise: 1 });
    const other = await pickedOrder(storeB, productB, managerB);

    const queue = await billingQueue(staffA, storeA);
    const ids = queue.map((q) => q.id);
    expect(ids).toContain(picked);
    expect(ids).not.toContain(billed);
    expect(ids).not.toContain(other);
    expect(queue.every((q) => q.status === 'PICKED')).toBe(true);
    await expect(billingQueue(managerB, storeA)).rejects.toThrow(/permission/i);
  });
});
