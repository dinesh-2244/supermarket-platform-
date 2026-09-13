import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearEventHandlersForTests,
  getPrisma,
  on,
  withTransaction,
  type DomainEventName,
  type Principal,
} from '@/modules/platform';
import { applyMovement } from '@/modules/inventory';
import { correctOrder, createOrder, type NewOrderLine } from '@/modules/orders';
import {
  acceptOrder,
  completePicking,
  pickingQueue,
  recordLinePick,
  startPicking,
} from '@/modules/fulfillment';
import {
  createCustomer,
  createInventoryItem,
  createProduct,
  createStoreProduct,
  createStoreWithProduct,
  createUser,
} from '../factories/index';

/**
 * P5-1 — picking, against a real database.
 *
 * On trial: every status change goes through `orders.transition` (history row,
 * stamp, event after commit); a short or unavailable line gives back exactly
 * `qtyOrdered − qtyPicked − stockRestoredQty` with a `StockLedger` row in the
 * same transaction; a later store correction cannot restore the same units
 * twice; picking cannot complete while a line is still pending; and none of
 * it is reachable from the other store or by a shopper.
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
let staffUserId: string;
const userIds: string[] = [];
const categoryIds: string[] = [];
const extraProducts: string[] = [];

beforeAll(async () => {
  const a = await createStoreWithProduct(prisma, { websiteStock: 100 });
  storeA = a.store.id;
  productA = a.product.id;
  categoryIds.push(a.product.categoryId);
  const second = await createProduct(prisma, { categoryId: a.product.categoryId });
  productA2 = second.id;
  extraProducts.push(second.id);
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
  await prisma.product.deleteMany({
    where: { id: { in: [productA, productB, ...extraProducts] } },
  });
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

/**
 * Place an order the way checkout does: the lines' stock leaves `websiteStock`
 * with an `ORDER_PLACED` ledger row, so a restore has something to give back.
 */
async function placeOrder(
  storeId: string,
  lines: readonly { productId: string; qty: number }[],
): Promise<{ id: string; lineIds: Record<string, string> }> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const newLines: NewOrderLine[] = lines.map((l) => ({
    productId: l.productId,
    nameSnapshot: 'Test Product',
    packSizeSnapshot: '1 kg',
    unitPricePaise: 12_500,
    qtyOrdered: l.qty,
  }));
  const id = await withTransaction(async (tx) => {
    for (const l of lines) {
      await applyMovement(tx, shopper, {
        storeId,
        productId: l.productId,
        delta: -l.qty,
        reason: 'ORDER_PLACED',
      });
    }
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
      subtotalPaise: newLines.reduce((s, l) => s + l.unitPricePaise * l.qtyOrdered, 0),
      deliveryFeePaise: 3_000,
      lines: newLines,
    });
    return created.id;
  });
  const rows = await prisma.orderLine.findMany({ where: { orderId: id } });
  const lineIds: Record<string, string> = {};
  for (const row of rows) lineIds[row.productId] = row.id;
  return { id, lineIds };
}

async function orderStatus(id: string): Promise<string> {
  return (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
}

async function history(id: string): Promise<string[]> {
  const rows = await prisma.orderStatusHistory.findMany({
    where: { orderId: id },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => r.toStatus);
}

describe('accept → start → complete, through the state machine', () => {
  let heard: DomainEventName[];
  beforeEach(() => {
    heard = [];
    for (const name of ['order.accepted', 'order.picking', 'order.picked'] as const) {
      on(name, () => {
        heard.push(name);
      });
    }
  });
  afterEach(() => clearEventHandlersForTests());

  it('accepts a PLACED order, opening its pick task', async () => {
    const { id } = await placeOrder(storeA, [{ productId: productA, qty: 2 }]);
    const outcome = await acceptOrder(staffA, id);
    expect(outcome).toMatchObject({ from: 'PLACED', to: 'ACCEPTED' });
    expect(await orderStatus(id)).toBe('ACCEPTED');
    const task = await prisma.pickTask.findUniqueOrThrow({ where: { orderId: id } });
    expect(task).toMatchObject({ status: 'OPEN', assignedUserId: null, startedAt: null });
    expect(heard).toEqual(['order.accepted']);
  });

  it('starts picking: claims the task for the actor and moves to PICKING', async () => {
    const { id } = await placeOrder(storeA, [{ productId: productA, qty: 2 }]);
    await acceptOrder(staffA, id);
    await startPicking(staffA, id);
    expect(await orderStatus(id)).toBe('PICKING');
    const task = await prisma.pickTask.findUniqueOrThrow({ where: { orderId: id } });
    expect(task.status).toBe('IN_PROGRESS');
    expect(task.assignedUserId).toBe(staffUserId);
    expect(task.startedAt).not.toBeNull();
    expect(heard).toEqual(['order.accepted', 'order.picking']);
  });

  it('completes picking once every line is resolved, and not before', async () => {
    const { id, lineIds } = await placeOrder(storeA, [
      { productId: productA, qty: 2 },
      { productId: productA2, qty: 1 },
    ]);
    await acceptOrder(staffA, id);
    await startPicking(staffA, id);
    await recordLinePick(staffA, id, lineIds[productA]!, { outcome: 'PICKED', qtyPicked: 2 });

    await expect(completePicking(staffA, id)).rejects.toThrow(/still to pick/i);
    expect(await orderStatus(id)).toBe('PICKING');

    await recordLinePick(staffA, id, lineIds[productA2]!, { outcome: 'PICKED', qtyPicked: 1 });
    const outcome = await completePicking(staffA, id);
    expect(outcome).toMatchObject({ from: 'PICKING', to: 'PICKED' });
    expect(await history(id)).toEqual(['PLACED', 'ACCEPTED', 'PICKING', 'PICKED']);
    const task = await prisma.pickTask.findUniqueOrThrow({ where: { orderId: id } });
    expect(task.status).toBe('DONE');
    expect(task.completedAt).not.toBeNull();
    expect(heard).toEqual(['order.accepted', 'order.picking', 'order.picked']);
  });

  it('refuses each step from the wrong state, writing nothing', async () => {
    const { id, lineIds } = await placeOrder(storeA, [{ productId: productA, qty: 2 }]);
    await expect(startPicking(staffA, id)).rejects.toThrow(/PLACED/);
    await expect(
      recordLinePick(staffA, id, lineIds[productA]!, { outcome: 'PICKED', qtyPicked: 2 }),
    ).rejects.toThrow(/not being picked/i);
    await expect(completePicking(staffA, id)).rejects.toThrow(/PLACED/);
    expect(await history(id)).toEqual(['PLACED']);
    expect(await prisma.pickTask.findUnique({ where: { orderId: id } })).toBeNull();
  });
});

describe('recording a line', () => {
  async function inPicking(
    lines: readonly { productId: string; qty: number }[],
  ): Promise<{ id: string; lineIds: Record<string, string> }> {
    const placed = await placeOrder(storeA, lines);
    await acceptOrder(staffA, placed.id);
    await startPicking(staffA, placed.id);
    return placed;
  }

  it('a full pick records the quantity and moves no stock', async () => {
    const before = await stockOf(storeA, productA);
    const { id, lineIds } = await inPicking([{ productId: productA, qty: 3 }]);
    const line = await recordLinePick(staffA, id, lineIds[productA]!, {
      outcome: 'PICKED',
      qtyPicked: 3,
    });
    expect(line).toMatchObject({ lineStatus: 'PICKED', qtyPicked: 3, stockRestoredQty: 0 });
    expect(await stockOf(storeA, productA)).toBe(before - 3);
  });

  it('a short pick restores exactly the unpicked remainder, with its ledger row, in one transaction', async () => {
    const before = await stockOf(storeA, productA);
    const { id, lineIds } = await inPicking([{ productId: productA, qty: 5 }]);
    expect(await stockOf(storeA, productA)).toBe(before - 5);

    const line = await recordLinePick(staffA, id, lineIds[productA]!, {
      outcome: 'SHORT',
      qtyPicked: 2,
      note: 'Only two on the shelf',
    });
    expect(line).toMatchObject({ lineStatus: 'SHORT', qtyPicked: 2, stockRestoredQty: 3 });
    expect(await stockOf(storeA, productA)).toBe(before - 5 + 3);

    const ledger = await prisma.stockLedger.findFirst({
      where: { storeId: storeA, productId: productA, reason: 'PICK_SHORT_RESTORE' },
      orderBy: { createdAt: 'desc' },
    });
    expect(ledger).toMatchObject({
      delta: 3,
      balanceAfter: before - 5 + 3,
      refType: 'Order',
      refId: id,
      actorType: 'USER',
      actorId: staffUserId,
    });
    const audit = await prisma.auditLog.findFirst({
      where: { entityType: 'OrderLine', entityId: lineIds[productA]! },
    });
    expect(audit).toMatchObject({ storeId: storeA, action: 'update' });
  });

  it('an unavailable line restores everything', async () => {
    const before = await stockOf(storeA, productA);
    const { id, lineIds } = await inPicking([{ productId: productA, qty: 4 }]);
    const line = await recordLinePick(staffA, id, lineIds[productA]!, {
      outcome: 'UNAVAILABLE',
      qtyPicked: 0,
    });
    expect(line).toMatchObject({ lineStatus: 'UNAVAILABLE', qtyPicked: 0, stockRestoredQty: 4 });
    expect(await stockOf(storeA, productA)).toBe(before);
  });

  it('a substitution restores the ordered product in full and leaves the substitute’s stock alone', async () => {
    // None of the ordered product left the shelf — the substitute went in its
    // place — so its reservation goes back. The substitute's own decrement is
    // a separate stock path, deliberately not part of this phase.
    const beforeA = await stockOf(storeA, productA);
    const beforeA2 = await stockOf(storeA, productA2);
    const { id, lineIds } = await inPicking([{ productId: productA, qty: 2 }]);
    expect(await stockOf(storeA, productA)).toBe(beforeA - 2);
    const line = await recordLinePick(staffA, id, lineIds[productA]!, {
      outcome: 'SUBSTITUTED',
      qtyPicked: 2,
      substituteProductId: productA2,
    });
    expect(line).toMatchObject({
      lineStatus: 'SUBSTITUTED',
      qtyPicked: 2,
      substituteProductId: productA2,
      stockRestoredQty: 2,
    });
    expect(await stockOf(storeA, productA)).toBe(beforeA);
    expect(await stockOf(storeA, productA2)).toBe(beforeA2);
    const ledger = await prisma.stockLedger.findFirst({
      where: { storeId: storeA, productId: productA, reason: 'PICK_SHORT_RESTORE', refId: id },
    });
    expect(ledger).toMatchObject({ delta: 2, balanceAfter: beforeA });
    // And a later correction has nothing left to restore for this line.
    const result = await correctOrder(managerA, id, 'Customer changed their mind');
    expect(result.restored).toEqual([]);
    expect(await stockOf(storeA, productA)).toBe(beforeA);
  });

  it('refuses a substitute the store does not list', async () => {
    const { id, lineIds } = await inPicking([{ productId: productA, qty: 2 }]);
    await expect(
      recordLinePick(staffA, id, lineIds[productA]!, {
        outcome: 'SUBSTITUTED',
        qtyPicked: 2,
        substituteProductId: productB,
      }),
    ).rejects.toThrow(/not listed/i);
  });

  it('a later store correction never restores what the short pick already gave back', async () => {
    const before = await stockOf(storeA, productA);
    const { id, lineIds } = await inPicking([{ productId: productA, qty: 5 }]);
    await recordLinePick(staffA, id, lineIds[productA]!, { outcome: 'SHORT', qtyPicked: 2 });
    expect(await stockOf(storeA, productA)).toBe(before - 2);

    // The correction restores only the 2 that were actually picked.
    const result = await correctOrder(managerA, id, 'Customer cancelled at the door');
    expect(result.restored).toEqual([{ productId: productA, qty: 2, balanceAfter: before }]);
    expect(await stockOf(storeA, productA)).toBe(before);
    const line = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineIds[productA]! } });
    expect(line.stockRestoredQty).toBe(5);
  });

  it('records a line once — a second recording is refused', async () => {
    const { id, lineIds } = await inPicking([{ productId: productA, qty: 2 }]);
    await recordLinePick(staffA, id, lineIds[productA]!, { outcome: 'PICKED', qtyPicked: 2 });
    await expect(
      recordLinePick(staffA, id, lineIds[productA]!, { outcome: 'SHORT', qtyPicked: 1 }),
    ).rejects.toThrow(/already/i);
  });

  it('refuses a line that belongs to a different order', async () => {
    const one = await inPicking([{ productId: productA, qty: 1 }]);
    const two = await inPicking([{ productId: productA, qty: 1 }]);
    await expect(
      recordLinePick(staffA, one.id, two.lineIds[productA]!, { outcome: 'PICKED', qtyPicked: 1 }),
    ).rejects.toThrow(/no such line/i);
  });
});

describe('who may pick', () => {
  it('refuses a shopper, and the other store’s staff — as not found', async () => {
    const { id, lineIds } = await placeOrder(storeA, [{ productId: productA, qty: 1 }]);
    await expect(acceptOrder(shopper, id)).rejects.toThrow(/permission/i);
    await expect(acceptOrder(managerB, id)).rejects.toThrow(/no such order/i);
    await acceptOrder(managerA, id);
    await expect(startPicking(managerB, id)).rejects.toThrow(/no such order/i);
    await startPicking(managerA, id);
    await expect(
      recordLinePick(managerB, id, lineIds[productA]!, { outcome: 'PICKED', qtyPicked: 1 }),
    ).rejects.toThrow(/no such order/i);
    await expect(completePicking(managerB, id)).rejects.toThrow(/no such order/i);
    expect(await orderStatus(id)).toBe('PICKING');
  });
});

describe('the picking queue', () => {
  it('lists the store’s ACCEPTED and PICKING orders with their task and line progress', async () => {
    const accepted = await placeOrder(storeA, [{ productId: productA, qty: 1 }]);
    await acceptOrder(staffA, accepted.id);
    const picking = await placeOrder(storeA, [
      { productId: productA, qty: 1 },
      { productId: productA2, qty: 1 },
    ]);
    await acceptOrder(staffA, picking.id);
    await startPicking(staffA, picking.id);
    await recordLinePick(staffA, picking.id, picking.lineIds[productA]!, {
      outcome: 'PICKED',
      qtyPicked: 1,
    });
    const other = await placeOrder(storeB, [{ productId: productB, qty: 1 }]);
    await acceptOrder(managerB, other.id);

    const queue = await pickingQueue(staffA, storeA);
    const ids = queue.map((q) => q.orderId);
    expect(ids).toContain(accepted.id);
    expect(ids).toContain(picking.id);
    expect(ids).not.toContain(other.id);
    const row = queue.find((q) => q.orderId === picking.id)!;
    expect(row).toMatchObject({
      status: 'PICKING',
      task: { status: 'IN_PROGRESS', assignedUserId: staffUserId },
      linesTotal: 2,
      linesResolved: 1,
    });
    await expect(pickingQueue(managerB, storeA)).rejects.toThrow(/permission/i);
  });
});
