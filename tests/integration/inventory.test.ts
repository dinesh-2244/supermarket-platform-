import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  clearEventHandlersForTests,
  getPrisma,
  on,
  withTransaction,
  type Principal,
} from '@/modules/platform';
import { createCategory, createProduct } from '@/modules/catalog';
import { createUser } from '@/modules/identity';
import { setPrice } from '@/modules/pricing';
import {
  adjustStock,
  applyMovement,
  getStock,
  listLedger,
  listLowStock,
  listStock,
  reconcileStock,
} from '@/modules/inventory';
import { createStore, createStoreSettings } from '../factories/index';
import { newTestClient } from './prisma-client';

/**
 * P2-5 — the ledger invariant (§3/§7), against a real PostgreSQL.
 *
 * Every case here is about one property: `websiteStock` and its `StockLedger`
 * row move together or not at all, and `balanceAfter` always equals the balance
 * that is actually in the table.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let admin: Principal;
let managerA: Principal;
let managerB: Principal;
let staffA: Principal;
let storeA: string;
let storeB: string;
let productId: string;
let secondProductId: string;
let categoryId: string;
const userIds: string[] = [];

async function ledgerFor(pid = productId): Promise<number> {
  return prisma.stockLedger.count({ where: { storeId: storeA, productId: pid } });
}

async function stockOf(pid = productId): Promise<number> {
  const item = await prisma.inventoryItem.findUnique({
    where: { storeId_productId: { storeId: storeA, productId: pid } },
  });
  return item?.websiteStock ?? -1;
}

beforeAll(async () => {
  const a = await createStore(prisma, { code: `INA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `INB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  await createStoreSettings(prisma, storeA, { lowStockThreshold: 5 });
  await createStoreSettings(prisma, storeB, { lowStockThreshold: 5 });

  const bootstrap: Principal = {
    kind: 'user',
    userId: 'inv-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const password = 'InventoryPassword12';
  const adminRow = await createUser(bootstrap, {
    email: `inv-admin-${suffix}@example.test`,
    name: 'Inventory Admin',
    password,
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  admin = { kind: 'user', userId: adminRow.id, role: 'SUPER_ADMIN', storeId: null };

  const mA = await createUser(admin, {
    email: `inv-mgr-a-${suffix}@example.test`,
    name: 'Inventory Manager A',
    password,
    role: 'STORE_MANAGER',
    storeId: storeA,
  });
  const mB = await createUser(admin, {
    email: `inv-mgr-b-${suffix}@example.test`,
    name: 'Inventory Manager B',
    password,
    role: 'STORE_MANAGER',
    storeId: storeB,
  });
  const sA = await createUser(admin, {
    email: `inv-stf-a-${suffix}@example.test`,
    name: 'Inventory Staff A',
    password,
    role: 'STORE_STAFF',
    storeId: storeA,
  });
  userIds.push(adminRow.id, mA.id, mB.id, sA.id);
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
  staffA = { kind: 'user', userId: sA.id, role: 'STORE_STAFF', storeId: storeA };

  categoryId = (await createCategory(admin, { name: `Inventory ${suffix}` })).id;
  productId = (
    await createProduct(admin, {
      sku: `INV-${suffix}`,
      name: `Stocked ${suffix}`,
      packSize: '1 kg',
      categoryId,
    })
  ).id;
  secondProductId = (
    await createProduct(admin, {
      sku: `INV2-${suffix}`,
      name: `Also Stocked ${suffix}`,
      packSize: '1 kg',
      categoryId,
    })
  ).id;

  for (const pid of [productId, secondProductId]) {
    await setPrice(admin, storeA, pid, { mrpPaise: 10_000, sellingPricePaise: 9_000 });
    await setPrice(admin, storeB, pid, { mrpPaise: 10_000, sellingPricePaise: 9_500 });
  }
});

afterAll(async () => {
  const stores = [storeA, storeB];
  const products = [productId, secondProductId];
  await prisma.stockLedger.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [...userIds, 'inv-bootstrap'] } } });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: { in: stores } } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.product.deleteMany({ where: { id: { in: products } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  clearEventHandlersForTests();
  // Reset to a known balance without going through the service.
  for (const pid of [productId, secondProductId]) {
    await prisma.inventoryItem.upsert({
      where: { storeId_productId: { storeId: storeA, productId: pid } },
      update: { websiteStock: 100 },
      create: { storeId: storeA, productId: pid, websiteStock: 100 },
    });
    await prisma.stockLedger.deleteMany({ where: { storeId: storeA, productId: pid } });
  }
});

describe('inventory — the ledger invariant on every path', () => {
  it('writes exactly one ledger row per adjustment, with the right delta and balance', async () => {
    const result = await adjustStock(managerA, {
      storeId: storeA,
      productId,
      delta: -12,
      note: 'Damaged in transit',
    });

    expect(result).toMatchObject({ balanceBefore: 100, balanceAfter: 88, delta: -12 });
    expect(await stockOf()).toBe(88);
    expect(await ledgerFor()).toBe(1);

    const row = await prisma.stockLedger.findFirstOrThrow({
      where: { storeId: storeA, productId },
    });
    expect(row).toMatchObject({
      delta: -12,
      balanceAfter: 88,
      reason: 'MANUAL_ADJUST',
      actorType: 'USER',
      note: 'Damaged in transit',
    });
    // The invariant, stated directly.
    expect(row.balanceAfter).toBe(await stockOf());
  });

  it('keeps balanceAfter equal to the real balance across a run of movements', async () => {
    const deltas = [+30, -5, -20, +7, -100, +2];
    for (const delta of deltas) {
      await adjustStock(managerA, { storeId: storeA, productId, delta });
    }

    const rows = await prisma.stockLedger.findMany({
      where: { storeId: storeA, productId },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(deltas.length);

    // Replay the ledger from the opening balance: it must land on the real one.
    let running = 100;
    for (const row of rows) {
      running += row.delta;
      expect(row.balanceAfter).toBe(running);
    }
    expect(running).toBe(await stockOf());
  });

  it('reconciles to a counted quantity and records the difference', async () => {
    const result = await reconcileStock(managerA, {
      storeId: storeA,
      productId,
      counted: 73,
      note: 'Monday count',
    });

    expect(result).toMatchObject({ delta: -27, balanceAfter: 73 });
    expect(await stockOf()).toBe(73);

    const row = await prisma.stockLedger.findFirstOrThrow({
      where: { storeId: storeA, productId },
    });
    expect(row).toMatchObject({ reason: 'RECONCILE', delta: -27, balanceAfter: 73 });

    const item = await getStock(managerA, storeA, productId);
    expect(item?.lastCountedAt).not.toBeNull();
  });

  // A count that agrees is still a count — but a zero-delta ledger row is noise.
  it('records the count time but no ledger row when the count agrees', async () => {
    const result = await reconcileStock(managerA, { storeId: storeA, productId, counted: 100 });

    expect(result).toBeNull();
    expect(await ledgerFor()).toBe(0);
    expect(await stockOf()).toBe(100);
    expect((await getStock(managerA, storeA, productId))?.lastCountedAt).not.toBeNull();
  });
});

describe('inventory — refusals leave nothing behind', () => {
  it('refuses to take stock below zero, and writes neither row', async () => {
    await expect(
      adjustStock(managerA, { storeId: storeA, productId, delta: -101 }),
    ).rejects.toThrow(/below zero/i);

    expect(await stockOf()).toBe(100);
    expect(await ledgerFor()).toBe(0);
  });

  it('refuses a zero or fractional movement', async () => {
    await expect(adjustStock(managerA, { storeId: storeA, productId, delta: 0 })).rejects.toThrow(
      /changes nothing/i,
    );
    await expect(adjustStock(managerA, { storeId: storeA, productId, delta: 1.5 })).rejects.toThrow(
      /whole number/i,
    );
    expect(await ledgerFor()).toBe(0);
  });

  it('refuses a negative counted quantity', async () => {
    await expect(
      reconcileStock(managerA, { storeId: storeA, productId, counted: -1 }),
    ).rejects.toThrow(/positive whole number/i);
    expect(await stockOf()).toBe(100);
  });

  // The whole point of requiring a Tx: a failure after the stock write must take
  // the stock write with it.
  it('rolls back the stock change when the transaction fails mid-operation', async () => {
    class Boom extends Error {}

    await expect(
      withTransaction(async (tx) => {
        await applyMovement(tx, managerA, {
          storeId: storeA,
          productId,
          delta: -40,
          reason: 'MANUAL_ADJUST',
        });
        // Everything above succeeded; now the operation dies.
        throw new Boom();
      }),
    ).rejects.toBeInstanceOf(Boom);

    expect(await stockOf()).toBe(100);
    expect(await ledgerFor()).toBe(0);
  });

  it('rolls back every item when a multi-item operation fails part-way', async () => {
    class Boom extends Error {}

    await expect(
      withTransaction(async (tx) => {
        await applyMovement(tx, managerA, {
          storeId: storeA,
          productId,
          delta: -10,
          reason: 'CSV_IMPORT',
        });
        await applyMovement(tx, managerA, {
          storeId: storeA,
          productId: secondProductId,
          delta: -10,
          reason: 'CSV_IMPORT',
        });
        throw new Boom();
      }),
    ).rejects.toBeInstanceOf(Boom);

    expect(await stockOf()).toBe(100);
    expect(await stockOf(secondProductId)).toBe(100);
    expect(await ledgerFor()).toBe(0);
    expect(await ledgerFor(secondProductId)).toBe(0);
  });
});

describe('inventory — concurrent mutations serialise via FOR UPDATE', () => {
  it('does not lose an update when two adjustments race', async () => {
    // Two independent connections, started together. Without the row lock both
    // would read 100 and both write 90 — one decrement silently lost.
    const other = newTestClient();
    try {
      await Promise.all([
        adjustStock(managerA, { storeId: storeA, productId, delta: -10 }),
        adjustStock(managerA, { storeId: storeA, productId, delta: -10 }),
      ]);

      expect(await stockOf()).toBe(80);

      const rows = await prisma.stockLedger.findMany({
        where: { storeId: storeA, productId },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      // Serialised: the balances are 90 then 80, never 90 twice.
      expect(new Set(rows.map((r) => r.balanceAfter))).toEqual(new Set([90, 80]));
    } finally {
      await other.$disconnect();
    }
  });

  it('serialises an adjust against a reconcile', async () => {
    await Promise.all([
      adjustStock(managerA, { storeId: storeA, productId, delta: -25 }),
      reconcileStock(managerA, { storeId: storeA, productId, counted: 50 }),
    ]);

    const rows = await prisma.stockLedger.findMany({
      where: { storeId: storeA, productId },
      orderBy: { createdAt: 'asc' },
    });

    // Whichever ran second saw the first one's balance, so the last ledger row
    // still describes the row that is actually in the table.
    const last = rows.at(-1);
    expect(last?.balanceAfter).toBe(await stockOf());

    let running = 100;
    for (const row of rows) {
      running += row.delta;
      expect(row.balanceAfter).toBe(running);
    }
  });
});

describe('inventory — events', () => {
  it('emits stock.changed for every movement', async () => {
    const seen: number[] = [];
    on('stock.changed', (payload) => seen.push(payload.balanceAfter));

    await adjustStock(managerA, { storeId: storeA, productId, delta: -1 });
    await adjustStock(managerA, { storeId: storeA, productId, delta: -1 });

    expect(seen).toEqual([99, 98]);
  });

  // Only the crossing — otherwise every sale of an already-low item alerts again
  // and the alert stops meaning anything.
  it('emits stock.low only when a movement crosses the threshold downward', async () => {
    const low: number[] = [];
    on('stock.low', (payload) => low.push(payload.balanceAfter));

    await adjustStock(managerA, { storeId: storeA, productId, delta: -94 }); // 100 -> 6, above 5
    expect(low).toEqual([]);

    await adjustStock(managerA, { storeId: storeA, productId, delta: -1 }); // 6 -> 5, crosses
    expect(low).toEqual([5]);

    await adjustStock(managerA, { storeId: storeA, productId, delta: -1 }); // 5 -> 4, already low
    expect(low).toEqual([5]);

    await adjustStock(managerA, { storeId: storeA, productId, delta: +50 }); // back up
    await adjustStock(managerA, { storeId: storeA, productId, delta: -50 }); // crosses again
    expect(low).toEqual([5, 4]);
  });

  it('does not emit when the movement was refused', async () => {
    const seen: number[] = [];
    on('stock.changed', (payload) => seen.push(payload.balanceAfter));

    await expect(
      adjustStock(managerA, { storeId: storeA, productId, delta: -500 }),
    ).rejects.toThrow();

    expect(seen).toEqual([]);
  });
});

describe('inventory — low stock report', () => {
  it('lists items at or below the store’s own threshold', async () => {
    await adjustStock(managerA, { storeId: storeA, productId, delta: -97 }); // 3
    await adjustStock(managerA, { storeId: storeA, productId: secondProductId, delta: -50 }); // 50

    const report = await listLowStock(managerA, storeA);

    expect(report.threshold).toBe(5);
    expect(report.items.map((i) => i.productId)).toContain(productId);
    expect(report.items.map((i) => i.productId)).not.toContain(secondProductId);
  });

  it('follows the store’s setting rather than a constant', async () => {
    // 100 -> 50: below a threshold of 60, comfortably above one of 5.
    await adjustStock(managerA, { storeId: storeA, productId: secondProductId, delta: -50 });
    expect((await listLowStock(managerA, storeA)).items.map((i) => i.productId)).not.toContain(
      secondProductId,
    );

    await prisma.storeSettings.update({
      where: { storeId: storeA },
      data: { lowStockThreshold: 60 },
    });
    try {
      const report = await listLowStock(managerA, storeA);
      expect(report.threshold).toBe(60);
      // Same row, same balance — only the store's own setting moved.
      expect(report.items.map((i) => i.productId)).toContain(secondProductId);
    } finally {
      await prisma.storeSettings.update({
        where: { storeId: storeA },
        data: { lowStockThreshold: 5 },
      });
    }
  });
});

describe('inventory — ledger view', () => {
  it('filters by reason, product and actor, newest first', async () => {
    await adjustStock(managerA, { storeId: storeA, productId, delta: -1 });
    await reconcileStock(managerA, { storeId: storeA, productId, counted: 50 });
    await adjustStock(managerA, { storeId: storeA, productId: secondProductId, delta: -3 });

    const all = await listLedger(managerA, { storeId: storeA });
    expect(all.length).toBeGreaterThanOrEqual(3);
    // Newest first.
    expect(all[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(all.at(-1)!.createdAt.getTime());

    const reconciles = await listLedger(managerA, { storeId: storeA, reasons: ['RECONCILE'] });
    expect(reconciles.every((r) => r.reason === 'RECONCILE')).toBe(true);

    const forProduct = await listLedger(managerA, { storeId: storeA, productId: secondProductId });
    expect(forProduct.every((r) => r.productId === secondProductId)).toBe(true);

    const byActor = await listLedger(managerA, {
      storeId: storeA,
      actorId: managerA.kind === 'user' ? managerA.userId : '',
    });
    expect(byActor.length).toBeGreaterThan(0);

    const future = await listLedger(managerA, {
      storeId: storeA,
      from: new Date(Date.now() + 60_000),
    });
    expect(future).toEqual([]);
  });
});

describe('inventory — cross-store denial (server-side)', () => {
  it('refuses a manager every write into another store', async () => {
    await expect(adjustStock(managerA, { storeId: storeB, productId, delta: -1 })).rejects.toThrow(
      /permission/i,
    );
    await expect(
      reconcileStock(managerA, { storeId: storeB, productId, counted: 1 }),
    ).rejects.toThrow(/permission/i);
    await expect(listLowStock(managerA, storeB)).rejects.toThrow(/permission/i);
    await expect(listLedger(managerA, { storeId: storeB })).rejects.toThrow(/permission/i);
    await expect(getStock(managerA, storeB, productId)).rejects.toThrow(/permission/i);

    // Manager B may, so the refusal is about the store and not the role.
    await expect(
      adjustStock(managerB, { storeId: storeB, productId, delta: +5 }),
    ).resolves.toMatchObject({ delta: 5 });
  });

  it('never shows another store’s rows in a list', async () => {
    await adjustStock(managerB, { storeId: storeB, productId, delta: +1 });

    const mine = await listStock(managerA);
    expect(mine.every((i) => i.storeId === storeA)).toBe(true);

    const all = await listStock(admin);
    expect(all.some((i) => i.storeId === storeB)).toBe(true);
  });

  it('lets staff read stock but never move it', async () => {
    await expect(listStock(staffA)).resolves.toBeInstanceOf(Array);
    await expect(listLedger(staffA, { storeId: storeA })).resolves.toBeInstanceOf(Array);
    await expect(adjustStock(staffA, { storeId: storeA, productId, delta: -1 })).rejects.toThrow(
      /permission/i,
    );
    await expect(
      reconcileStock(staffA, { storeId: storeA, productId, counted: 1 }),
    ).rejects.toThrow(/permission/i);
  });
});

describe('inventory — audit', () => {
  it('writes a before/after AuditLog row alongside the ledger', async () => {
    await adjustStock(managerA, { storeId: storeA, productId, delta: -4 });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'InventoryItem', entityId: `${storeA}:${productId}` },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry.action).toBe('adjust');
    expect(entry.beforeJson).toMatchObject({ websiteStock: 100 });
    expect(entry.afterJson).toMatchObject({ websiteStock: 96, delta: -4 });
  });
});
