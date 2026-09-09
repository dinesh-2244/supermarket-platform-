import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, withTransaction, type Principal, type Tx } from '@/modules/platform';
import {
  applyTransition,
  cancelByStore,
  createOrder,
  transition,
  type NewOrderLine,
} from '@/modules/orders';
import { createCustomer, createStoreWithProduct, createUser } from '../factories/index';

/**
 * P4-1 — the write half of the state machine, against a real database.
 *
 * The pure table is unit-tested exhaustively in
 * `src/modules/orders/__tests__/state-machine.test.ts`. What can only be shown
 * here is that the *writes* keep their promises: a status change and its
 * `OrderStatusHistory` row commit together, an illegal edge leaves no trace, and
 * the correction restores exactly what is still outstanding — once.
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

  const second = await createStoreWithProduct(prisma, { websiteStock: 100 });
  storeB = second.store.id;
  productB = second.product.id;

  const customer = await createCustomer(prisma);
  customerId = customer.id;

  const mA = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeA });
  const mB = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeB });
  const sA = await createUser(prisma, { role: 'STORE_STAFF', storeId: storeA });
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
  staffA = { kind: 'user', userId: sA.id, role: 'STORE_STAFF', storeId: storeA };
  userIds.push(mA.id, mB.id, sA.id);

  for (const product of [a.product, second.product]) {
    categoryIds.push(product.categoryId);
  }
});

/**
 * Put the database back as it was found.
 *
 * `schema.test.ts` asserts on *global* counts — two stores, three users, every
 * stock balance explained by an opening-balance ledger row — so a suite file
 * that leaves rows behind does not fail itself, it fails a different file on the
 * next run against the same database. Every integration file here cleans up for
 * that reason.
 */
afterAll(async () => {
  const stores = [storeA, storeB];
  // Lines and history cascade from the order; the audit rows do not.
  await prisma.auditLog.deleteMany({ where: { entityType: 'Order' } });
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

function lines(productId: string, qty = 2): NewOrderLine[] {
  return [
    {
      productId,
      nameSnapshot: 'Test Product',
      packSizeSnapshot: '1 kg',
      unitPricePaise: 12_500,
      qtyOrdered: qty,
    },
  ];
}

async function placeOrder(
  storeId: string,
  productId: string,
  qty = 2,
): Promise<{ id: string; orderNumber: string }> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  return withTransaction(async (tx: Tx) => {
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
      subtotalPaise: 12_500 * qty,
      deliveryFeePaise: 3_000,
      lines: lines(productId, qty),
    });
    return { id: created.id, orderNumber: created.orderNumber };
  });
}

describe('createOrder', () => {
  it('writes the order at PLACED with an opening history row and no transition', async () => {
    const { id } = await placeOrder(storeA, productA, 3);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id },
      include: { lines: true, statusHistory: true },
    });

    expect(order.status).toBe('PLACED');
    expect(order.estimatedTotalPaise).toBe(12_500 * 3 + 3_000);
    expect(order.subtotalPaise).toBe(37_500);
    expect(order.lines).toHaveLength(1);
    expect(order.lines[0]).toMatchObject({ qtyOrdered: 3, stockRestoredQty: 0 });

    // Exactly one history row, and it opens with `fromStatus: null` — PLACED is
    // an initial state, not an edge.
    expect(order.statusHistory).toHaveLength(1);
    expect(order.statusHistory[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'PLACED',
      actorType: 'CUSTOMER',
    });
    expect(order.acceptedAt).toBeNull();
  });

  it('derives the estimated total rather than trusting a caller', async () => {
    const { id } = await placeOrder(storeA, productA, 4);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });

    expect(order.estimatedTotalPaise).toBe(order.subtotalPaise + order.deliveryFeePaise);
  });

  it('mints a unique order number and an opaque tracking token per order', async () => {
    const first = await placeOrder(storeA, productA);
    const second = await placeOrder(storeA, productA);

    expect(first.orderNumber).not.toBe(second.orderNumber);

    const rows = await prisma.order.findMany({
      where: { id: { in: [first.id, second.id] } },
      select: { trackingToken: true },
    });
    expect(new Set(rows.map((row) => row.trackingToken)).size).toBe(2);
    for (const row of rows) expect(row.trackingToken).toMatch(/^t_[0-9A-Z]{20}$/);
  });

  it('refuses an order with no lines', async () => {
    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeA } });
    await expect(
      withTransaction((tx) =>
        createOrder(tx, {
          storeCode: store.code,
          customerId,
          storeId: storeA,
          contactName: 'Asha',
          contactPhone: '9000000001',
          deliveryAddressSnapshot: {},
          deliverySlotStart: new Date('2026-03-01T10:00:00Z'),
          deliverySlotEnd: new Date('2026-03-01T11:00:00Z'),
          paymentMethod: 'COD',
          subtotalPaise: 0,
          deliveryFeePaise: 0,
          lines: [],
        }),
      ),
    ).rejects.toThrow(/at least one line/i);
  });
});

describe('transition', () => {
  it('moves the status, stamps the column and writes history in one transaction', async () => {
    const { id } = await placeOrder(storeA, productA);

    await applyTransition(managerA, id, 'ACCEPTED', 'confirmed by phone');

    const order = await prisma.order.findUniqueOrThrow({
      where: { id },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
    });

    expect(order.status).toBe('ACCEPTED');
    expect(order.acceptedAt).not.toBeNull();
    expect(order.statusHistory).toHaveLength(2);
    expect(order.statusHistory[1]).toMatchObject({
      fromStatus: 'PLACED',
      toStatus: 'ACCEPTED',
      actorType: 'USER',
      note: 'confirmed by phone',
    });
  });

  it('writes nothing at all for an illegal edge', async () => {
    const { id } = await placeOrder(storeA, productA);

    await expect(applyTransition(managerA, id, 'DELIVERED')).rejects.toThrow(/cannot go from/i);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id },
      include: { statusHistory: true },
    });
    expect(order.status).toBe('PLACED');
    expect(order.deliveredAt).toBeNull();
    // Still only the opening row: a refused edge leaves no history behind.
    expect(order.statusHistory).toHaveLength(1);
  });

  it('refuses an unknown order', async () => {
    await expect(
      applyTransition(managerA, '00000000-0000-4000-8000-000000000000', 'ACCEPTED'),
    ).rejects.toThrow(/no such order/i);
  });

  it('blocks PACKED -> OUT_FOR_DELIVERY while the variance is unconfirmed', async () => {
    const { id } = await placeOrder(storeA, productA);
    for (const to of ['ACCEPTED', 'PICKING', 'PICKED', 'BILLED_IN_POS', 'PACKED'] as const) {
      await applyTransition(managerA, id, to);
    }
    await prisma.order.update({
      where: { id },
      data: { priceVarianceFlagged: true, posFinalTotalPaise: 99_999 },
    });

    await expect(applyTransition(managerA, id, 'OUT_FOR_DELIVERY')).rejects.toThrow(
      /confirm the revised amount/i,
    );
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).dispatchedAt).toBeNull();

    await prisma.order.update({ where: { id }, data: { customerConfirmedRevisedAmount: true } });
    await applyTransition(managerA, id, 'OUT_FOR_DELIVERY');

    const after = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(after.status).toBe('OUT_FOR_DELIVERY');
    expect(after.dispatchedAt).not.toBeNull();
  });

  it('rolls the status change back with the rest of a failing transaction', async () => {
    const { id } = await placeOrder(storeA, productA);

    await expect(
      withTransaction(async (tx) => {
        await transition(tx, id, 'ACCEPTED', managerA);
        throw new Error('something after the transition blew up');
      }),
    ).rejects.toThrow(/blew up/);

    const order = await prisma.order.findUniqueOrThrow({
      where: { id },
      include: { statusHistory: true },
    });
    // The whole point of taking a `Tx`: neither the status nor its history row
    // survives a failure later in the same transaction.
    expect(order.status).toBe('PLACED');
    expect(order.statusHistory).toHaveLength(1);
  });
});

describe('cancelByStore', () => {
  async function stockOf(storeId: string, productId: string): Promise<number> {
    const item = await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } });
    return item.websiteStock;
  }

  it('restores every ordered unit with an ADMIN_CORRECTION ledger row', async () => {
    const { id } = await placeOrder(storeA, productA, 5);
    // Placement itself does not decrement here — that is `checkout.placeOrder`
    // (P4-2). This test is about what the correction gives back, so it sets the
    // shelf up explicitly.
    const before = await stockOf(storeA, productA);

    const result = await withTransaction((tx) =>
      cancelByStore(tx, id, managerA, 'customer unreachable'),
    );

    expect(result.restored).toEqual([{ productId: productA, qty: 5, balanceAfter: before + 5 }]);
    expect(await stockOf(storeA, productA)).toBe(before + 5);

    const ledger = await prisma.stockLedger.findMany({
      where: { refType: 'Order', refId: id },
    });
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      reason: 'ADMIN_CORRECTION',
      delta: 5,
      balanceAfter: before + 5,
    });

    const order = await prisma.order.findUniqueOrThrow({
      where: { id },
      include: { lines: true, statusHistory: { orderBy: { createdAt: 'asc' } } },
    });
    expect(order.status).toBe('CANCELLED_BY_STORE');
    expect(order.correctedAt).not.toBeNull();
    expect(order.correctionReason).toBe('customer unreachable');
    expect(order.lines[0]?.stockRestoredQty).toBe(5);
    expect(order.statusHistory.at(-1)).toMatchObject({
      toStatus: 'CANCELLED_BY_STORE',
      note: 'customer unreachable',
    });

    const audit = await prisma.auditLog.findMany({
      where: { entityType: 'Order', entityId: id },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]?.storeId).toBe(storeA);
  });

  it('restores only what a prior short-pick restore left outstanding', async () => {
    const { id } = await placeOrder(storeA, productA, 6);
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } });
    // Phase 5's short-pick restore, simulated: 4 of the 6 already given back.
    await prisma.orderLine.update({ where: { id: line.id }, data: { stockRestoredQty: 4 } });

    const before = await stockOf(storeA, productA);
    const result = await withTransaction((tx) => cancelByStore(tx, id, managerA, 'short picked'));

    expect(result.restored).toEqual([{ productId: productA, qty: 2, balanceAfter: before + 2 }]);
    expect(await stockOf(storeA, productA)).toBe(before + 2);
    const after = await prisma.orderLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(after.stockRestoredQty).toBe(6);
  });

  it('restores nothing, and writes no ledger row, when the line is already square', async () => {
    const { id } = await placeOrder(storeA, productA, 3);
    const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } });
    await prisma.orderLine.update({ where: { id: line.id }, data: { stockRestoredQty: 3 } });

    const before = await stockOf(storeA, productA);
    const result = await withTransaction((tx) =>
      cancelByStore(tx, id, managerA, 'already restored'),
    );

    expect(result.restored).toEqual([]);
    expect(await stockOf(storeA, productA)).toBe(before);
    expect(await prisma.stockLedger.count({ where: { refType: 'Order', refId: id } })).toBe(0);
  });

  it('cannot double-restore when run twice', async () => {
    const { id } = await placeOrder(storeA, productA, 4);
    const before = await stockOf(storeA, productA);

    await withTransaction((tx) => cancelByStore(tx, id, managerA, 'first'));
    // The second attempt is refused by the state gate — CANCELLED_BY_STORE is
    // terminal — which is the outer of the two defences. `stockRestoredQty` is
    // the inner one, asserted above.
    await expect(
      withTransaction((tx) => cancelByStore(tx, id, managerA, 'second')),
    ).rejects.toThrow(/no longer be cancelled/i);

    expect(await stockOf(storeA, productA)).toBe(before + 4);
    expect(await prisma.stockLedger.count({ where: { refType: 'Order', refId: id } })).toBe(1);
  });

  it('refuses once the order is with the rider, leaving stock alone', async () => {
    const { id } = await placeOrder(storeA, productA, 2);
    for (const to of ['ACCEPTED', 'PICKING', 'PICKED', 'BILLED_IN_POS', 'PACKED'] as const) {
      await applyTransition(managerA, id, to);
    }
    await applyTransition(managerA, id, 'OUT_FOR_DELIVERY');

    const before = await stockOf(storeA, productA);
    await expect(
      withTransaction((tx) => cancelByStore(tx, id, managerA, 'too late')),
    ).rejects.toThrow(/no longer be cancelled/i);
    expect(await stockOf(storeA, productA)).toBe(before);
  });

  it('requires a discrepancy note once a POS bill exists', async () => {
    const { id } = await placeOrder(storeA, productA, 2);
    for (const to of ['ACCEPTED', 'PICKING', 'PICKED', 'BILLED_IN_POS'] as const) {
      await applyTransition(managerA, id, to);
    }

    await expect(
      withTransaction((tx) => cancelByStore(tx, id, managerA, 'wrong item')),
    ).rejects.toThrow(/how the bill was voided/i);

    const result = await withTransaction((tx) =>
      cancelByStore(tx, id, managerA, 'wrong item', 'bill 4471 voided at till 2'),
    );
    expect(result.restored[0]?.qty).toBe(2);
    const order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(order.correctionReason).toContain('bill 4471 voided');
  });

  it('requires a reason', async () => {
    const { id } = await placeOrder(storeA, productA);
    await expect(withTransaction((tx) => cancelByStore(tx, id, managerA, '   '))).rejects.toThrow(
      /needs a reason/i,
    );
  });

  it('refuses a manager from the other store, and staff from this one', async () => {
    const { id } = await placeOrder(storeA, productA, 2);
    const before = await stockOf(storeA, productA);

    await expect(
      withTransaction((tx) => cancelByStore(tx, id, managerB, 'not my store')),
    ).rejects.toThrow(/permission/i);
    await expect(
      withTransaction((tx) => cancelByStore(tx, id, staffA, 'not my call')),
    ).rejects.toThrow(/permission/i);
    await expect(
      withTransaction((tx) => cancelByStore(tx, id, shopper, 'let me out')),
    ).rejects.toThrow(/permission/i);

    expect(await stockOf(storeA, productA)).toBe(before);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe('PLACED');
  });

  it('leaves the other store untouched', async () => {
    const { id } = await placeOrder(storeB, productB, 3);
    const beforeA = await stockOf(storeA, productA);

    await withTransaction((tx) => cancelByStore(tx, id, managerB, 'store B correction'));

    expect(await stockOf(storeA, productA)).toBe(beforeA);
  });
});

describe('the storefront has no way to end an order', () => {
  it('a customer principal is refused the correction outright', async () => {
    const { id } = await placeOrder(storeA, productA);
    const account: Principal = { kind: 'customer', customerId, storeId: storeA };

    await expect(
      withTransaction((tx) => cancelByStore(tx, id, account, 'I changed my mind')),
    ).rejects.toThrow(/permission/i);
  });
});
