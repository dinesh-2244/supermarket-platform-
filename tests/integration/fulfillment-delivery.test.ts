import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearEventHandlersForTests,
  getPrisma,
  on,
  withTransaction,
  type DomainEventName,
  type Principal,
} from '@/modules/platform';
import {
  closeOrder,
  closeUndelivered,
  completePicking,
  confirmRevisedAmount,
  deliveryQueue,
  dispatch,
  markPacked,
  recordDelivered,
  recordDeliveryFailed,
  recordFinalBill,
  recordLinePick,
  retryDelivery,
} from '@/modules/fulfillment';
import { applyMovement } from '@/modules/inventory';
import {
  createCustomer,
  createInventoryItem,
  createProduct,
  createStoreProduct,
  createStoreWithProduct,
  createUser,
} from '../factories/index';
import { placeOrder, walkTo } from './helpers/fulfillment-walk';

/**
 * P5-4 — the delivery outcome, against a real database.
 *
 * Every edge out of `OUT_FOR_DELIVERY` and `DELIVERY_FAILED`, the
 * `DeliveryRecord` fields each outcome sets, the payment capture rules, and
 * the two closers: `DELIVERED → CLOSED` (a staff confirmation — see
 * `closeOrder`) and `DELIVERY_FAILED → CLOSED_UNDELIVERED` with a reason.
 */
const prisma = getPrisma();

let storeA: string;
let storeB: string;
let productA: string;
let productA2: string;
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
  productA2 = (await createProduct(prisma, { categoryId: a.product.categoryId })).id;
  await createStoreProduct(prisma, storeA, productA2, { sellingPricePaise: 5_000 });
  await createInventoryItem(prisma, storeA, productA2, { websiteStock: 50 });
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
  await prisma.product.deleteMany({ where: { id: { in: [productA, productA2, productB] } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

const shopper: Principal = { kind: 'customer', customerId: null, storeId: null };

async function stockOf(storeId: string, productId: string): Promise<number> {
  const item = await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } });
  return item.websiteStock;
}
async function order(id: string) {
  return prisma.order.findUniqueOrThrow({ where: { id } });
}
async function delivery(id: string) {
  return prisma.deliveryRecord.findUniqueOrThrow({ where: { orderId: id } });
}
async function history(id: string): Promise<string[]> {
  const rows = await prisma.orderStatusHistory.findMany({
    where: { orderId: id },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => r.toStatus);
}

/** An order out for delivery, in store A unless told otherwise. */
async function outForDelivery(storeId = storeA, productId = productA, actor = staffA) {
  const id = await placeOrder(storeId, productId, customerId);
  await walkTo(actor, id, 'PACKED');
  await dispatch(actor, id, { assigneeName: 'Ravi' });
  return id;
}

/** What the rider must collect: the POS bill, locked at billing. */
async function due(id: string): Promise<number> {
  return (await order(id)).posFinalTotalPaise!;
}

describe('delivered', () => {
  let heard: DomainEventName[];
  beforeEach(() => {
    heard = [];
    for (const name of [
      'order.delivered',
      'order.delivery_failed',
      'order.dispatched',
      'order.closed',
      'order.closed_undelivered',
    ] as const) {
      on(name, () => {
        heard.push(name);
      });
    }
  });
  afterEach(() => clearEventHandlersForTests());

  it('records a cash delivery: status, stamp, payment, event', async () => {
    const id = await outForDelivery();
    heard.length = 0; // the dispatch inside the fixture is not what is on trial
    const total = (await order(id)).posFinalTotalPaise!;
    const outcome = await recordDelivered(staffA, id, {
      paymentMethodUsed: 'CASH',
      amountCollectedPaise: total,
    });
    expect(outcome).toMatchObject({ from: 'OUT_FOR_DELIVERY', to: 'DELIVERED' });
    const row = await order(id);
    expect(row.status).toBe('DELIVERED');
    expect(row.deliveredAt).not.toBeNull();
    expect(await delivery(id)).toMatchObject({
      status: 'DELIVERED',
      paymentMethodUsed: 'CASH',
      amountCollectedPaise: total,
      upiRef: null,
    });
    expect((await delivery(id)).deliveredAt).not.toBeNull();
    expect(heard).toEqual(['order.delivered']);
  });

  it('records a UPI delivery with its reference', async () => {
    const id = await outForDelivery();
    await recordDelivered(staffA, id, {
      paymentMethodUsed: 'UPI',
      amountCollectedPaise: await due(id),
      upiRef: ' 4123456789 ',
    });
    expect(await delivery(id)).toMatchObject({ paymentMethodUsed: 'UPI', upiRef: '4123456789' });
  });

  it('refuses a UPI delivery without a reference, and a cash one with', async () => {
    const id = await outForDelivery();
    const total = await due(id);
    await expect(
      recordDelivered(staffA, id, { paymentMethodUsed: 'UPI', amountCollectedPaise: total }),
    ).rejects.toThrow(/UPI reference/i);
    await expect(
      recordDelivered(staffA, id, {
        paymentMethodUsed: 'CASH',
        amountCollectedPaise: total,
        upiRef: 'x',
      }),
    ).rejects.toThrow(/cash/i);
    expect((await order(id)).status).toBe('OUT_FOR_DELIVERY');
    expect((await delivery(id)).status).toBe('OUT');
  });

  it('refuses an amount that is not a whole non-negative number of paise', async () => {
    const id = await outForDelivery();
    await expect(
      recordDelivered(staffA, id, { paymentMethodUsed: 'CASH', amountCollectedPaise: 10.5 }),
    ).rejects.toThrow(/whole/i);
    await expect(
      recordDelivered(staffA, id, { paymentMethodUsed: 'CASH', amountCollectedPaise: -1 }),
    ).rejects.toThrow(/whole/i);
  });

  it('refuses a delivery that collects nothing, less, or more than the POS bill — atomically', async () => {
    const id = await outForDelivery();
    heard.length = 0;
    const total = await due(id);
    expect(total).toBeGreaterThan(0);
    const auditsBefore = await prisma.auditLog.count({
      where: { entityType: 'Order', entityId: id },
    });
    for (const amount of [0, total - 1, total + 1]) {
      await expect(
        recordDelivered(staffA, id, { paymentMethodUsed: 'CASH', amountCollectedPaise: amount }),
      ).rejects.toThrow(/POS bill/i);
      await expect(
        recordDelivered(staffA, id, {
          paymentMethodUsed: 'UPI',
          amountCollectedPaise: amount,
          upiRef: 'r1',
        }),
      ).rejects.toThrow(/POS bill/i);
    }
    // Nothing moved: no status, no stamp, no payment, no audit, no event.
    const row = await order(id);
    expect(row.status).toBe('OUT_FOR_DELIVERY');
    expect(row.deliveredAt).toBeNull();
    expect(await delivery(id)).toMatchObject({
      status: 'OUT',
      deliveredAt: null,
      amountCollectedPaise: null,
      paymentMethodUsed: null,
    });
    expect(await prisma.auditLog.count({ where: { entityType: 'Order', entityId: id } })).toBe(
      auditsBefore,
    );
    expect(heard).toEqual([]);
    // The exact bill goes through.
    await recordDelivered(staffA, id, { paymentMethodUsed: 'CASH', amountCollectedPaise: total });
    expect((await order(id)).status).toBe('DELIVERED');
  });

  it('audits the POS bill as the amount due — not the estimate — on a varied order', async () => {
    const id = await placeOrder(storeA, productA, customerId);
    const estimated = (await order(id)).estimatedTotalPaise;
    await walkTo(staffA, id, 'PACKED', { finalTotalPaise: estimated * 2 });
    await confirmRevisedAmount(managerA, id);
    await dispatch(staffA, id, { assigneeName: 'Ravi' });
    const total = await due(id);
    expect(total).toBe(estimated * 2);

    // The estimate is what the customer saw at checkout; it is not what is due.
    await expect(
      recordDelivered(staffA, id, { paymentMethodUsed: 'CASH', amountCollectedPaise: estimated }),
    ).rejects.toThrow(/POS bill/i);
    await recordDelivered(staffA, id, { paymentMethodUsed: 'CASH', amountCollectedPaise: total });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'Order', entityId: id, action: 'update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.afterJson).toMatchObject({
      status: 'DELIVERED',
      amountCollectedPaise: total,
      amountDuePaise: total,
    });
    expect((audit.afterJson as { amountDuePaise: number }).amountDuePaise).not.toBe(estimated);
  });

  it('closes a delivered order on staff confirmation, and never twice', async () => {
    const id = await outForDelivery();
    heard.length = 0;
    await recordDelivered(staffA, id, {
      paymentMethodUsed: 'CASH',
      amountCollectedPaise: await due(id),
    });
    const outcome = await closeOrder(staffA, id);
    expect(outcome).toMatchObject({ from: 'DELIVERED', to: 'CLOSED' });
    expect((await order(id)).closedAt).not.toBeNull();
    await expect(closeOrder(staffA, id)).rejects.toThrow(/CLOSED/);
    expect(heard).toEqual(['order.delivered', 'order.closed']);
  });
});

describe('failed, retried, given up', () => {
  it('records a failed attempt with its reason, keeping the order retryable', async () => {
    const id = await outForDelivery();
    const outcome = await recordDeliveryFailed(staffA, id, {
      failureReason: ' Nobody home, phone off ',
    });
    expect(outcome).toMatchObject({ from: 'OUT_FOR_DELIVERY', to: 'DELIVERY_FAILED' });
    expect(await delivery(id)).toMatchObject({
      status: 'FAILED',
      failureReason: 'Nobody home, phone off',
      deliveredAt: null,
    });
    const last = await prisma.orderStatusHistory.findFirst({
      where: { orderId: id },
      orderBy: { createdAt: 'desc' },
    });
    expect(last).toMatchObject({ toStatus: 'DELIVERY_FAILED', note: 'Nobody home, phone off' });
  });

  it('needs a reason to record a failure', async () => {
    const id = await outForDelivery();
    await expect(recordDeliveryFailed(staffA, id, { failureReason: '  ' })).rejects.toThrow(
      /reason/i,
    );
    expect((await order(id)).status).toBe('OUT_FOR_DELIVERY');
  });

  it('re-dispatches a failed delivery on the same record, then delivers', async () => {
    const id = await outForDelivery();
    await recordDeliveryFailed(staffA, id, { failureReason: 'Nobody home' });
    const outcome = await retryDelivery(staffA, id, { assigneeName: 'Meena' });
    expect(outcome).toMatchObject({ from: 'DELIVERY_FAILED', to: 'OUT_FOR_DELIVERY' });
    expect(await delivery(id)).toMatchObject({ status: 'OUT', assigneeName: 'Meena' });
    expect(await prisma.deliveryRecord.count({ where: { orderId: id } })).toBe(1);

    await recordDelivered(staffA, id, {
      paymentMethodUsed: 'CASH',
      amountCollectedPaise: await due(id),
    });
    expect(await history(id)).toEqual([
      'PLACED',
      'ACCEPTED',
      'PICKING',
      'PICKED',
      'BILLED_IN_POS',
      'PACKED',
      'OUT_FOR_DELIVERY',
      'DELIVERY_FAILED',
      'OUT_FOR_DELIVERY',
      'DELIVERED',
    ]);
  });

  it('closes a failed delivery as undelivered, with a reason, terminally — and puts the goods back', async () => {
    const before = await stockOf(storeA, productA);
    const id = await outForDelivery(); // 2 units left the shelf at placement
    expect(await stockOf(storeA, productA)).toBe(before - 2);
    await recordDeliveryFailed(staffA, id, { failureReason: 'Nobody home' });
    await expect(closeUndelivered(staffA, id, '  ')).rejects.toThrow(/reason/i);
    expect(await stockOf(storeA, productA)).toBe(before - 2);

    const outcome = await closeUndelivered(staffA, id, 'Three attempts, customer unreachable');
    expect(outcome).toMatchObject({ from: 'DELIVERY_FAILED', to: 'CLOSED_UNDELIVERED' });
    expect((await order(id)).closedAt).not.toBeNull();
    // The goods are back at the shop: the picked units return to website
    // stock with a ledger row, and the line's counter says so.
    expect(await stockOf(storeA, productA)).toBe(before);
    const ledger = await prisma.stockLedger.findFirst({
      where: { storeId: storeA, productId: productA, reason: 'PICK_SHORT_RESTORE', refId: id },
    });
    expect(ledger).toMatchObject({ delta: 2, balanceAfter: before });
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } });
    expect(line.stockRestoredQty).toBe(2);
    await expect(retryDelivery(staffA, id)).rejects.toThrow(/CLOSED_UNDELIVERED/);
    await expect(closeUndelivered(staffA, id, 'again')).rejects.toThrow(/CLOSED_UNDELIVERED/);
  });

  it('closing undelivered restores only what picking had not already given back', async () => {
    const before = await stockOf(storeA, productA);
    const id = await placeOrder(storeA, productA, customerId, 3);
    await walkTo(staffA, id, 'PICKING');
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } });
    // Short pick: 1 of 3 goes into the basket, 2 restored at once.
    await recordLinePick(staffA, id, line.id, { outcome: 'SHORT', qtyPicked: 1 });
    await completePicking(staffA, id);
    const est = (await order(id)).estimatedTotalPaise;
    await recordFinalBill(staffA, id, { billNumber: 'POS-U', finalTotalPaise: est });
    await markPacked(staffA, id);
    await dispatch(staffA, id);
    expect(await stockOf(storeA, productA)).toBe(before - 1);
    await recordDeliveryFailed(staffA, id, { failureReason: 'Refused' });
    await closeUndelivered(staffA, id, 'Refused at the door');
    expect(await stockOf(storeA, productA)).toBe(before);
    expect(
      (await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } })).stockRestoredQty,
    ).toBe(3);
  });

  it('closing undelivered puts the substitute back too — what the ledger says is still out', async () => {
    // Order 3 of A; the picker substitutes 2 of A2. Picking restored all 3 of
    // A (none left the shelf) and took 2 of A2. The undelivered close must
    // give those 2 back — derived from the ledger, not from qtyPicked, so a
    // unit that already came back (a manual return against the same line)
    // is not credited twice.
    const beforeA = await stockOf(storeA, productA);
    const beforeA2 = await stockOf(storeA, productA2);
    const id = await placeOrder(storeA, productA, customerId, 3);
    await walkTo(staffA, id, 'PICKING');
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } });
    await recordLinePick(staffA, id, line.id, {
      outcome: 'SUBSTITUTED',
      qtyPicked: 2,
      substituteProductId: productA2,
    });
    await completePicking(staffA, id);
    const est = (await order(id)).estimatedTotalPaise;
    await recordFinalBill(staffA, id, { billNumber: 'POS-S', finalTotalPaise: est });
    await markPacked(staffA, id);
    await dispatch(staffA, id);
    expect(await stockOf(storeA, productA)).toBe(beforeA);
    expect(await stockOf(storeA, productA2)).toBe(beforeA2 - 2);

    // One unit already found its way back against this line (say, a manual
    // return keyed the same way). Only the other one is still out.
    await withTransaction((tx) =>
      applyMovement(tx, managerA, {
        storeId: storeA,
        productId: productA2,
        delta: 1,
        reason: 'MANUAL_ADJUST',
        refType: 'Order',
        refId: id,
        note: `substitute on line ${line.id}`,
      }),
    );
    expect(await stockOf(storeA, productA2)).toBe(beforeA2 - 1);

    await recordDeliveryFailed(staffA, id, { failureReason: 'Refused' });
    await closeUndelivered(staffA, id, 'Refused at the door');
    expect(await stockOf(storeA, productA)).toBe(beforeA);
    expect(await stockOf(storeA, productA2)).toBe(beforeA2);
    const back = await prisma.stockLedger.findFirst({
      where: {
        storeId: storeA,
        productId: productA2,
        refId: id,
        reason: 'PICK_SHORT_RESTORE',
      },
    });
    expect(back).toMatchObject({ delta: 1, balanceAfter: beforeA2 });
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'Order', entityId: id, action: 'update' },
      orderBy: { createdAt: 'desc' },
    });
    expect((audit.afterJson as { restored: unknown[] }).restored).toEqual([
      { productId: productA2, qty: 1, balanceAfter: beforeA2, substituteForLineId: line.id },
    ]);
  });

  it('refuses each outcome from the wrong state', async () => {
    const id = await placeOrder(storeA, productA, customerId);
    await walkTo(staffA, id, 'PACKED');
    await expect(
      recordDelivered(staffA, id, {
        paymentMethodUsed: 'CASH',
        amountCollectedPaise: await due(id),
      }),
    ).rejects.toThrow(/PACKED/);
    await expect(recordDeliveryFailed(staffA, id, { failureReason: 'x' })).rejects.toThrow(
      /PACKED/,
    );
    await expect(retryDelivery(staffA, id)).rejects.toThrow(/PACKED/);
    await expect(closeUndelivered(staffA, id, 'x')).rejects.toThrow(/PACKED/);
    await expect(closeOrder(staffA, id)).rejects.toThrow(/PACKED/);
    expect((await order(id)).status).toBe('PACKED');
  });
});

describe('who may record an outcome', () => {
  it('refuses a shopper, and the other store’s manager as not found', async () => {
    const id = await outForDelivery();
    await expect(
      recordDelivered(shopper, id, {
        paymentMethodUsed: 'CASH',
        amountCollectedPaise: await due(id),
      }),
    ).rejects.toThrow(/permission/i);
    await expect(
      recordDelivered(managerB, id, { paymentMethodUsed: 'CASH', amountCollectedPaise: 1 }),
    ).rejects.toThrow(/no such order/i);
    await expect(recordDeliveryFailed(managerB, id, { failureReason: 'x' })).rejects.toThrow(
      /no such order/i,
    );
    expect((await order(id)).status).toBe('OUT_FOR_DELIVERY');
    expect(await delivery(id)).toMatchObject({ status: 'OUT' });
  });
});

describe('the delivery queue', () => {
  it('lists the store’s OUT_FOR_DELIVERY and DELIVERY_FAILED orders with their records', async () => {
    const out = await outForDelivery();
    const failed = await outForDelivery();
    await recordDeliveryFailed(staffA, failed, { failureReason: 'Nobody home' });
    const done = await outForDelivery();
    await recordDelivered(staffA, done, {
      paymentMethodUsed: 'CASH',
      amountCollectedPaise: await due(done),
    });
    const other = await outForDelivery(storeB, productB, managerB);

    const queue = await deliveryQueue(staffA, storeA);
    const byId = new Map(queue.map((q) => [q.orderId, q]));
    expect(byId.get(out)).toMatchObject({
      status: 'OUT_FOR_DELIVERY',
      delivery: { status: 'OUT', assigneeName: 'Ravi' },
    });
    expect(byId.get(failed)).toMatchObject({
      status: 'DELIVERY_FAILED',
      delivery: { status: 'FAILED', failureReason: 'Nobody home' },
    });
    expect(byId.has(done)).toBe(false);
    expect(byId.has(other)).toBe(false);
    await expect(deliveryQueue(managerB, storeA)).rejects.toThrow(/permission/i);
  });
});
