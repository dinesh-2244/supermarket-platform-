import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { createCategory, createProduct } from '@/modules/catalog';
import { createUser } from '@/modules/identity';
import { setPrice } from '@/modules/pricing';
import {
  errorReportCsv,
  getImportRun,
  listImportHistory,
  planStockImport,
  runStockImport,
} from '@/modules/inventory';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * P2-6 — validate every row before applying any, then apply the whole file in
 * one transaction.
 *
 * The property under test throughout: **zero partial application**. A file with
 * one bad row must leave the database exactly as it found it, and say why.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let admin: Principal;
let managerA: Principal;
let managerB: Principal;
let staffA: Principal;
let storeA: string;
let storeB: string;
let skuA: string;
let skuB: string;
let productA: string;
let productB: string;
let categoryId: string;
const userIds: string[] = [];

const header = 'sku,quantity,mode';

async function stock(productId: string, storeId = storeA): Promise<number> {
  const item = await prisma.inventoryItem.findUnique({
    where: { storeId_productId: { storeId, productId } },
  });
  return item?.websiteStock ?? -1;
}

async function ledgerCount(storeId = storeA): Promise<number> {
  return prisma.stockLedger.count({ where: { storeId } });
}

beforeAll(async () => {
  const a = await createStore(prisma, { code: `IMA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `IMB-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  await createStoreSettings(prisma, storeA, { lowStockThreshold: 5 });
  await createStoreSettings(prisma, storeB, { lowStockThreshold: 5 });

  const bootstrap: Principal = {
    kind: 'user',
    userId: 'imp-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const password = 'ImportPassword1234';
  const adminRow = await createUser(bootstrap, {
    email: `imp-admin-${suffix}@example.test`,
    name: 'Import Admin',
    password,
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  admin = { kind: 'user', userId: adminRow.id, role: 'SUPER_ADMIN', storeId: null };

  const mA = await createUser(admin, {
    email: `imp-mgr-a-${suffix}@example.test`,
    name: 'Import Manager A',
    password,
    role: 'STORE_MANAGER',
    storeId: storeA,
  });
  const mB = await createUser(admin, {
    email: `imp-mgr-b-${suffix}@example.test`,
    name: 'Import Manager B',
    password,
    role: 'STORE_MANAGER',
    storeId: storeB,
  });
  const sA = await createUser(admin, {
    email: `imp-stf-a-${suffix}@example.test`,
    name: 'Import Staff A',
    password,
    role: 'STORE_STAFF',
    storeId: storeA,
  });
  userIds.push(adminRow.id, mA.id, mB.id, sA.id);
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: mB.id, role: 'STORE_MANAGER', storeId: storeB };
  staffA = { kind: 'user', userId: sA.id, role: 'STORE_STAFF', storeId: storeA };

  categoryId = (await createCategory(admin, { name: `Import ${suffix}` })).id;
  skuA = `IMP-A-${suffix}`;
  skuB = `IMP-B-${suffix}`;
  productA = (
    await createProduct(admin, {
      sku: skuA,
      name: `Import A ${suffix}`,
      packSize: '1 kg',
      categoryId,
    })
  ).id;
  productB = (
    await createProduct(admin, {
      sku: skuB,
      name: `Import B ${suffix}`,
      packSize: '1 kg',
      categoryId,
    })
  ).id;

  // Only store A lists both — store B lists neither, which is what makes the
  // wrong-store case real.
  for (const pid of [productA, productB]) {
    await setPrice(admin, storeA, pid, { mrpPaise: 10_000, sellingPricePaise: 9_000 });
  }
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.inventoryImport.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.stockLedger.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [...userIds, 'imp-bootstrap'] } } });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: { in: stores } } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.product.deleteMany({ where: { id: { in: [productA, productB] } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  for (const pid of [productA, productB]) {
    await prisma.inventoryItem.upsert({
      where: { storeId_productId: { storeId: storeA, productId: pid } },
      update: { websiteStock: 50 },
      create: { storeId: storeA, productId: pid, websiteStock: 50 },
    });
  }
  await prisma.stockLedger.deleteMany({ where: { storeId: storeA } });
  await prisma.inventoryImport.deleteMany({ where: { storeId: storeA } });
});

describe('import — a valid file applies atomically', () => {
  it('writes one CSV_IMPORT ledger row per changed item with the right balance', async () => {
    const content = [header, `${skuA},80,set`, `${skuB},-20,delta`].join('\n');
    const result = await runStockImport(managerA, {
      storeId: storeA,
      filename: 'monday.csv',
      content,
    });

    expect(result.outcome).toBe('applied');
    expect(result.applied).toBe(2);
    expect(await stock(productA)).toBe(80);
    expect(await stock(productB)).toBe(30);

    const rows = await prisma.stockLedger.findMany({ where: { storeId: storeA } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.reason === 'CSV_IMPORT')).toBe(true);
    expect(rows.every((r) => r.refType === 'import' && r.refId === 'monday.csv')).toBe(true);

    const byProduct = new Map(rows.map((r) => [r.productId, r]));
    expect(byProduct.get(productA)?.balanceAfter).toBe(80);
    expect(byProduct.get(productA)?.delta).toBe(30);
    expect(byProduct.get(productB)?.balanceAfter).toBe(30);
    expect(byProduct.get(productB)?.delta).toBe(-20);
  });

  it('does not write a ledger row for a row that changes nothing', async () => {
    const result = await runStockImport(managerA, {
      storeId: storeA,
      filename: 'noop.csv',
      content: [header, `${skuA},50,set`, `${skuB},10,delta`].join('\n'),
    });

    expect(result.applied).toBe(1);
    expect(result.unchanged.map((c) => c.sku)).toEqual([skuA]);
    expect(await ledgerCount()).toBe(1);
  });

  it('records the run in the import history', async () => {
    await runStockImport(managerA, {
      storeId: storeA,
      filename: 'history.csv',
      content: [header, `${skuA},60,set`].join('\n'),
    });

    const history = await listImportHistory(managerA, storeA);
    expect(history[0]).toMatchObject({
      filename: 'history.csv',
      outcome: 'applied',
      appliedCount: 1,
      errorCount: 0,
      actorUserId: managerA.kind === 'user' ? managerA.userId : null,
    });
  });
});

describe('import — one bad row rejects the whole file', () => {
  // The property the plan is built around: no partial application.
  it('writes nothing at all when any row is invalid', async () => {
    const content = [
      header,
      `${skuA},80,set`, // would have applied
      `NOT-A-REAL-SKU,10,set`, // unknown
      `${skuB},abc,set`, // not a number
    ].join('\n');

    const result = await runStockImport(managerA, {
      storeId: storeA,
      filename: 'broken.csv',
      content,
    });

    expect(result.outcome).toBe('rejected');
    expect(result.applied).toBe(0);
    // Untouched.
    expect(await stock(productA)).toBe(50);
    expect(await stock(productB)).toBe(50);
    expect(await ledgerCount()).toBe(0);

    expect(result.errors.map((e) => e.line)).toEqual([4, 3]);
    expect(result.errors.map((e) => e.message).join(' ')).toMatch(/whole number|No product/);
  });

  it('rejects a SKU that exists but is not set up for this store', async () => {
    // Store B lists nothing, so a perfectly real SKU is out of scope there.
    const result = await runStockImport(managerB, {
      storeId: storeB,
      filename: 'wrong-store.csv',
      content: [header, `${skuA},10,set`].join('\n'),
    });

    expect(result.outcome).toBe('rejected');
    expect(result.errors[0]?.message).toMatch(/not set up for this store/i);
    expect(await ledgerCount(storeB)).toBe(0);
  });

  it('rejects a delta that would drive stock below zero', async () => {
    const result = await runStockImport(managerA, {
      storeId: storeA,
      filename: 'negative.csv',
      content: [header, `${skuA},-1,delta`, `${skuB},-999,delta`].join('\n'),
    });

    expect(result.outcome).toBe('rejected');
    expect(result.errors[0]?.message).toMatch(/below zero/i);
    // Including the row that *was* fine.
    expect(await stock(productA)).toBe(50);
    expect(await ledgerCount()).toBe(0);
  });

  it('still records a rejected run, with its errors, so the file can be fixed', async () => {
    const result = await runStockImport(managerA, {
      storeId: storeA,
      filename: 'rejected.csv',
      content: [header, `NOPE,1,set`].join('\n'),
    });

    const run = await getImportRun(managerA, result.importId);
    expect(run).toMatchObject({ outcome: 'rejected', appliedCount: 0, errorCount: 1 });
    expect(errorReportCsv(result.errors)).toContain('No product with that SKU');
    expect(errorReportCsv(result.errors).split('\n')[0]).toBe('line,sku,error');
  });

  it('refuses a binary or oversized file outright', async () => {
    await expect(
      runStockImport(managerA, {
        storeId: storeA,
        filename: 'book.xlsx',
        content: 'PKjunk',
      }),
    ).rejects.toThrow(/export it as csv/i);

    await expect(
      runStockImport(managerA, {
        storeId: storeA,
        filename: 'huge.csv',
        content: [header, `${skuA},1,set`].join('\n'),
        byteLength: 50 * 1024 * 1024,
      }),
    ).rejects.toThrow(/larger than/i);

    expect(await ledgerCount()).toBe(0);
  });
});

describe('import — dry run', () => {
  it('reports the true diff and writes nothing', async () => {
    const plan = await runStockImport(managerA, {
      storeId: storeA,
      filename: 'dry.csv',
      content: [header, `${skuA},80,set`, `${skuB},-20,delta`].join('\n'),
      dryRun: true,
    });

    expect(plan.outcome).toBe('dry-run');
    expect(plan.applied).toBe(0);
    expect(plan.changes).toHaveLength(2);
    expect(plan.changes.find((c) => c.sku === skuA)).toMatchObject({
      currentStock: 50,
      newStock: 80,
      delta: 30,
    });

    // Nothing moved.
    expect(await stock(productA)).toBe(50);
    expect(await stock(productB)).toBe(50);
    expect(await ledgerCount()).toBe(0);

    const history = await listImportHistory(managerA, storeA);
    expect(history[0]).toMatchObject({ outcome: 'dry-run', appliedCount: 0 });
  });

  it('planStockImport alone touches nothing', async () => {
    const plan = await planStockImport(managerA, {
      storeId: storeA,
      filename: 'plan.csv',
      content: [header, `${skuA},1,set`].join('\n'),
    });
    expect(plan.ok).toBe(true);
    expect(await stock(productA)).toBe(50);
    expect(await prisma.inventoryImport.count({ where: { storeId: storeA } })).toBe(0);
  });
});

describe('import — re-running the same file', () => {
  // `set` is idempotent; `delta` is not. That is what the two modes mean, and
  // the import history is how an operator tells whether a file already ran.
  it('is idempotent in set mode and cumulative in delta mode', async () => {
    const setFile = [header, `${skuA},80,set`].join('\n');
    await runStockImport(managerA, { storeId: storeA, filename: 's.csv', content: setFile });
    const second = await runStockImport(managerA, {
      storeId: storeA,
      filename: 's.csv',
      content: setFile,
    });

    expect(await stock(productA)).toBe(80);
    expect(second.applied).toBe(0);
    expect(second.unchanged).toHaveLength(1);

    const deltaFile = [header, `${skuB},-5,delta`].join('\n');
    await runStockImport(managerA, { storeId: storeA, filename: 'd.csv', content: deltaFile });
    await runStockImport(managerA, { storeId: storeA, filename: 'd.csv', content: deltaFile });
    expect(await stock(productB)).toBe(40);
  });
});

describe('import — authorization', () => {
  it('refuses a manager an import into another store', async () => {
    await expect(
      runStockImport(managerA, {
        storeId: storeB,
        filename: 'x.csv',
        content: [header, `${skuA},1,set`].join('\n'),
      }),
    ).rejects.toThrow(/permission/i);
    await expect(listImportHistory(managerA, storeB)).rejects.toThrow(/permission/i);
  });

  it('refuses staff any import at all', async () => {
    await expect(
      runStockImport(staffA, {
        storeId: storeA,
        filename: 'x.csv',
        content: [header, `${skuA},1,set`].join('\n'),
      }),
    ).rejects.toThrow(/permission/i);
    // …but they may read the history.
    await expect(listImportHistory(staffA, storeA)).resolves.toBeInstanceOf(Array);
  });
});

describe('import — audit', () => {
  it('writes an AuditLog row for an applied import', async () => {
    const result = await runStockImport(managerA, {
      storeId: storeA,
      filename: 'audited.csv',
      content: [header, `${skuA},70,set`].join('\n'),
    });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'InventoryImport', entityId: result.importId },
    });
    expect(entry.action).toBe('import');
    expect(entry.afterJson).toMatchObject({ filename: 'audited.csv', applied: 1 });
  });
});
