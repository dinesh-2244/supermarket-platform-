import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { createCategory, createProduct, updateCategory } from '@/modules/catalog';
import { createUser } from '@/modules/identity';
import { getListing, listPriceHistory, setPrice } from '@/modules/pricing';
import { runStockImport } from '@/modules/inventory';
import { adjustStock } from '@/modules/inventory';
import { setPrice as setPriceAgain } from '@/modules/pricing';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * The corrective round's concurrency repros (R2, R4, R6).
 *
 * Each one uses a **real lock-wait barrier**, the way OSCAR reproduced them: a
 * separate connection takes the row lock and holds it, the service call is
 * started and blocks on that lock, and only then is the lock released. Sleeping
 * and hoping would make these tests prove nothing on a fast machine.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;

let admin: Principal;
let managerA: Principal;
let storeA: string;
let productA: string;
let skuA: string;
let categoryId: string;
const userIds: string[] = [];
/** Products created inside a test, torn down with the rest of the fixture. */
const extraProductIds: string[] = [];

/** Wait until `check()` is true, polling — for "has the writer blocked yet?". */
async function until(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the barrier condition');
}

/** True once at least `n` backends are blocked waiting on a lock. */
async function waitingBackends(n: number): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count
    FROM pg_stat_activity
    WHERE wait_event_type = 'Lock' AND state = 'active'
  `;
  return Number(rows[0]?.count ?? 0n) >= n;
}

beforeAll(async () => {
  const store = await createStore(prisma, { code: `CON-${suffix.slice(-5)}` });
  storeA = store.id;
  await createStoreSettings(prisma, storeA, { lowStockThreshold: 5 });

  const bootstrap: Principal = {
    kind: 'user',
    userId: 'con-bootstrap',
    role: 'SUPER_ADMIN',
    storeId: null,
  };
  const password = 'ConcurrencyPass123';
  const adminRow = await createUser(bootstrap, {
    email: `con-admin-${suffix}@example.test`,
    name: 'Concurrency Admin',
    password,
    role: 'SUPER_ADMIN',
    storeId: null,
  });
  admin = { kind: 'user', userId: adminRow.id, role: 'SUPER_ADMIN', storeId: null };

  const mgr = await createUser(admin, {
    email: `con-mgr-${suffix}@example.test`,
    name: 'Concurrency Manager',
    password,
    role: 'STORE_MANAGER',
    storeId: storeA,
  });
  userIds.push(adminRow.id, mgr.id);
  managerA = { kind: 'user', userId: mgr.id, role: 'STORE_MANAGER', storeId: storeA };

  categoryId = (await createCategory(admin, { name: `Concurrency ${suffix}` })).id;
  skuA = `CON-${suffix}`;
  productA = (
    await createProduct(admin, {
      sku: skuA,
      name: `Contended ${suffix}`,
      packSize: '1 kg',
      categoryId,
    })
  ).id;
  await setPrice(admin, storeA, productA, { mrpPaise: 10_000, sellingPricePaise: 100 });
});

afterAll(async () => {
  await prisma.inventoryImport.deleteMany({ where: { storeId: storeA } });
  await prisma.stockLedger.deleteMany({ where: { storeId: storeA } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: storeA } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [...userIds, 'con-bootstrap'] } } });
  await prisma.priceChange.deleteMany({ where: { storeProduct: { storeId: storeA } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: storeA } });
  await prisma.product.deleteMany({ where: { id: { in: [productA, ...extraProductIds] } } });
  await prisma.category.deleteMany({ where: { name: { contains: suffix } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: storeA } });
  await prisma.store.deleteMany({ where: { id: storeA } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.inventoryItem.upsert({
    where: { storeId_productId: { storeId: storeA, productId: productA } },
    update: { websiteStock: 100 },
    create: { storeId: storeA, productId: productA, websiteStock: 100 },
  });
  await prisma.stockLedger.deleteMany({ where: { storeId: storeA } });
  await prisma.inventoryImport.deleteMany({ where: { storeId: storeA } });
});

describe('R2 — a concurrent import must not write a stale absolute stock', () => {
  /**
   * OSCAR's exact scenario: stock 100, an import setting it to 110 blocks on the
   * row lock, and a +10 adjust commits while it waits. The old code added its
   * *precomputed* delta of +10 to the new balance, landing on 120 while
   * reporting 110.
   */
  it('recomputes a set-mode diff from the locked balance, not the planned one', async () => {
    const holder = new PrismaClient();
    try {
      let importResult: Awaited<ReturnType<typeof runStockImport>> | undefined;
      let importing: Promise<void> | undefined;

      await holder.$transaction(async (tx) => {
        // Hold the row lock so the import blocks after planning against 100.
        await tx.$queryRaw`
          SELECT "id" FROM "InventoryItem"
          WHERE "storeId" = ${storeA} AND "productId" = ${productA}
          FOR UPDATE
        `;

        importing = runStockImport(managerA, {
          storeId: storeA,
          filename: 'race.csv',
          content: `sku,quantity,mode\n${skuA},125,set\n`,
        }).then((result) => {
          importResult = result;
        });

        await until(() => waitingBackends(1));

        // Move the balance underneath it: 100 -> 110.
        await tx.$executeRaw`
          UPDATE "InventoryItem" SET "websiteStock" = "websiteStock" + 10
          WHERE "storeId" = ${storeA} AND "productId" = ${productA}
        `;
      });

      await importing;

      const actual = await prisma.inventoryItem.findUniqueOrThrow({
        where: { storeId_productId: { storeId: storeA, productId: productA } },
      });

      // `set 125` means 125. The old code added its *planned* delta (125-100=25)
      // to the balance it eventually saw (110) and landed on 135 while reporting
      // 125 — stock and report disagreeing is the whole defect.
      expect(actual.websiteStock).toBe(125);
      expect(importResult?.applied).toBe(1);
      expect(importResult?.changes[0]).toMatchObject({
        currentStock: 110,
        newStock: 125,
        delta: 15,
      });

      const ledger = await prisma.stockLedger.findFirstOrThrow({
        where: { storeId: storeA, productId: productA },
        orderBy: { createdAt: 'desc' },
      });
      // The ledger describes the row that is actually in the table.
      expect(ledger.delta).toBe(15);
      expect(ledger.balanceAfter).toBe(125);
      expect(ledger.balanceAfter).toBe(actual.websiteStock);
    } finally {
      await holder.$disconnect();
    }
  }, 60_000);

  /**
   * N3: the row ends up unchanged because the concurrent adjust already got it
   * there. Stock and ledger were always right; the *reported* row said
   * "100 -> 110 (+10)" because it was filtered out of the stale plan rather than
   * rebuilt from the balance this transaction locked.
   */
  it('reports an overtaken row from the locked balance, not the planned one', async () => {
    const holder = new PrismaClient();
    try {
      let importResult: Awaited<ReturnType<typeof runStockImport>> | undefined;
      let importing: Promise<void> | undefined;

      await holder.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "InventoryItem"
          WHERE "storeId" = ${storeA} AND "productId" = ${productA}
          FOR UPDATE
        `;

        importing = runStockImport(managerA, {
          storeId: storeA,
          filename: 'overtaken.csv',
          content: `sku,quantity,mode\n${skuA},110,set\n`,
        }).then((result) => {
          importResult = result;
        });

        await until(() => waitingBackends(1));

        // The adjust gets there first: 100 -> 110, which is what the file asked
        // for. There is now nothing for the import to do.
        await tx.$executeRaw`
          UPDATE "InventoryItem" SET "websiteStock" = "websiteStock" + 10
          WHERE "storeId" = ${storeA} AND "productId" = ${productA}
        `;
      });

      await importing;

      const actual = await prisma.inventoryItem.findUniqueOrThrow({
        where: { storeId_productId: { storeId: storeA, productId: productA } },
      });
      expect(actual.websiteStock).toBe(110);

      expect(importResult?.applied).toBe(0);
      expect(importResult?.changes).toEqual([]);
      expect(importResult?.unchanged).toHaveLength(1);
      expect(importResult?.unchanged[0]).toMatchObject({
        sku: skuA,
        currentStock: 110,
        newStock: 110,
        delta: 0,
      });

      // And no movement was invented to justify a number nobody moved.
      expect(
        await prisma.stockLedger.count({
          where: { storeId: storeA, productId: productA, reason: 'CSV_IMPORT' },
        }),
      ).toBe(0);
    } finally {
      await holder.$disconnect();
    }
  }, 60_000);

  it('reports the movements that actually committed', async () => {
    const result = await runStockImport(managerA, {
      storeId: storeA,
      filename: 'report.csv',
      content: `sku,quantity,mode\n${skuA},130,set\n`,
    });

    expect(result.applied).toBe(1);
    expect(result.changes[0]).toMatchObject({ currentStock: 100, newStock: 130, delta: 30 });

    const actual = await prisma.inventoryItem.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA, productId: productA } },
    });
    expect(actual.websiteStock).toBe(result.changes[0]?.newStock);
  });

  it('a set import racing an adjust never leaves stock disagreeing with the ledger', async () => {
    await Promise.all([
      runStockImport(managerA, {
        storeId: storeA,
        filename: 'race2.csv',
        content: `sku,quantity,mode\n${skuA},80,set\n`,
      }),
      adjustStock(managerA, { storeId: storeA, productId: productA, delta: -5 }),
    ]);

    const actual = await prisma.inventoryItem.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA, productId: productA } },
    });
    const rows = await prisma.stockLedger.findMany({
      where: { storeId: storeA, productId: productA },
      orderBy: { createdAt: 'asc' },
    });

    // Replay from the opening balance: the ledger must land on the real value.
    let running = 100;
    for (const row of rows) {
      running += row.delta;
      expect(row.balanceAfter).toBe(running);
    }
    expect(actual.websiteStock).toBe(running);
  }, 60_000);

  it('two set imports of the same row serialise', async () => {
    await Promise.all([
      runStockImport(managerA, {
        storeId: storeA,
        filename: 'a.csv',
        content: `sku,quantity,mode\n${skuA},70,set\n`,
      }),
      runStockImport(managerA, {
        storeId: storeA,
        filename: 'b.csv',
        content: `sku,quantity,mode\n${skuA},90,set\n`,
      }),
    ]);

    const actual = await prisma.inventoryItem.findUniqueOrThrow({
      where: { storeId_productId: { storeId: storeA, productId: productA } },
    });
    const last = await prisma.stockLedger.findFirstOrThrow({
      where: { storeId: storeA, productId: productA },
      orderBy: { createdAt: 'desc' },
    });

    // Whichever committed second wrote its own absolute value.
    expect([70, 90]).toContain(actual.websiteStock);
    expect(last.balanceAfter).toBe(actual.websiteStock);
  }, 60_000);
});

describe('R4 — concurrent price edits must record the real previous price', () => {
  /**
   * Two writers blocked on the same `StoreProduct` row lock. The old code read
   * the before-state outside the transaction, so both recorded "old price 100"
   * and the history no longer reconstructed 100 → 200 → 300.
   */
  it('reads the before-state under the lock, so the history chains', async () => {
    await setPrice(admin, storeA, productA, { mrpPaise: 10_000, sellingPricePaise: 100 });
    const listing = await getListing(admin, storeA, productA);
    await prisma.priceChange.deleteMany({ where: { storeProductId: listing!.id } });

    const holder = new PrismaClient();
    try {
      const writers: Promise<unknown>[] = [];

      await holder.$transaction(async (tx) => {
        await tx.$queryRaw`
          SELECT "id" FROM "StoreProduct" WHERE "id" = ${listing!.id} FOR UPDATE
        `;

        writers.push(
          setPrice(managerA, storeA, productA, { mrpPaise: 10_000, sellingPricePaise: 200 }),
        );
        await until(() => waitingBackends(1));
        writers.push(
          setPriceAgain(managerA, storeA, productA, { mrpPaise: 10_000, sellingPricePaise: 300 }),
        );
        await until(() => waitingBackends(2));
      });

      await Promise.all(writers);

      const history = await listPriceHistory(admin, listing!.id, 20);
      const chain = [...history].reverse();

      // Each entry's old price is the previous entry's new price — a real chain,
      // not two edits both claiming to have started from 100.
      for (const [index, change] of chain.entries()) {
        if (index === 0) continue;
        expect(change.oldSellingPricePaise).toBe(chain[index - 1]!.newSellingPricePaise);
      }

      const current = await getListing(admin, storeA, productA);
      expect(chain.at(-1)?.newSellingPricePaise).toBe(current?.sellingPricePaise);
    } finally {
      await holder.$disconnect();
    }
  }, 60_000);
});

describe('R4 — the *first* price of a product must chain too', () => {
  /**
   * OSCAR's residual: the row lock protects an existing listing, but a listing
   * that does not exist yet has no row to lock, so two simultaneous first prices
   * both read `before === null` and both recorded a change starting from zero
   * (0→300 *and* 0→200) instead of chaining. Reachable from the first-price UI
   * with entirely valid input.
   *
   * The barrier is the `Product` row: inserting a `StoreProduct` takes a
   * `FOR KEY SHARE` lock on its parent, which a held `FOR UPDATE` blocks — so
   * both writers are stopped in the middle of creating the listing.
   */
  it('serialises two simultaneous first prices on the pair, not on the row', async () => {
    const fresh = await createProduct(admin, {
      sku: `CONF-${suffix}`,
      name: `First Price ${suffix}`,
      packSize: '1 kg',
      categoryId,
    });
    extraProductIds.push(fresh.id);

    const holder = new PrismaClient();
    try {
      const writers: Promise<unknown>[] = [];

      await holder.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${fresh.id} FOR UPDATE`;

        writers.push(
          setPrice(managerA, storeA, fresh.id, { mrpPaise: 10_000, sellingPricePaise: 300 }),
        );
        await until(() => waitingBackends(1));
        writers.push(
          setPriceAgain(managerA, storeA, fresh.id, { mrpPaise: 10_000, sellingPricePaise: 200 }),
        );
        // Both are stopped: one on the foreign key, one on the pair lock.
        await until(() => waitingBackends(2));
      });

      await Promise.all(writers);

      const listing = await getListing(admin, storeA, fresh.id);
      expect(listing).not.toBeNull();

      const history = await listPriceHistory(admin, listing!.id, 20);
      const chain = [...history].reverse();
      expect(chain).toHaveLength(2);

      // Exactly one entry may start from "no price". The old behaviour had two.
      expect(chain.filter((change) => change.oldSellingPricePaise === 0)).toHaveLength(1);
      expect(chain[0]?.oldSellingPricePaise).toBe(0);

      for (const [index, change] of chain.entries()) {
        if (index === 0) continue;
        expect(change.oldSellingPricePaise).toBe(chain[index - 1]!.newSellingPricePaise);
        expect(change.oldMrpPaise).toBe(chain[index - 1]!.newMrpPaise);
      }

      // …and the end of the chain is the price the store is actually charging.
      expect(chain.at(-1)?.newSellingPricePaise).toBe(listing?.sellingPricePaise);
      expect([200, 300]).toContain(listing?.sellingPricePaise);
    } finally {
      await holder.$disconnect();
    }
  }, 60_000);

  // Whichever order they land in, the same invariant must hold with no barrier
  // at all — the fix must not depend on the shape of the repro.
  it('chains an unbarriered pair of first prices', async () => {
    const fresh = await createProduct(admin, {
      sku: `CONF2-${suffix}`,
      name: `First Price Two ${suffix}`,
      packSize: '1 kg',
      categoryId,
    });
    extraProductIds.push(fresh.id);

    await Promise.all([
      setPrice(managerA, storeA, fresh.id, { mrpPaise: 10_000, sellingPricePaise: 111 }),
      setPriceAgain(managerA, storeA, fresh.id, { mrpPaise: 10_000, sellingPricePaise: 222 }),
    ]);

    const listing = await getListing(admin, storeA, fresh.id);
    const chain = [...(await listPriceHistory(admin, listing!.id, 20))].reverse();

    expect(chain.filter((change) => change.oldSellingPricePaise === 0)).toHaveLength(1);
    for (const [index, change] of chain.entries()) {
      if (index === 0) continue;
      expect(change.oldSellingPricePaise).toBe(chain[index - 1]!.newSellingPricePaise);
    }
    expect(chain.at(-1)?.newSellingPricePaise).toBe(listing?.sellingPricePaise);
  }, 60_000);
});

describe('R6 — concurrent reparenting must not create a cycle', () => {
  it('refuses the second of two crossing moves', async () => {
    const a = await createCategory(admin, { name: `Cyc A ${suffix}` });
    const b = await createCategory(admin, { name: `Cyc B ${suffix}` });

    // Both validate against an acyclic tree; only one may commit.
    const results = await Promise.allSettled([
      updateCategory(admin, a.id, { parentId: b.id }),
      updateCategory(admin, b.id, { parentId: a.id }),
    ]);

    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(1);

    // And the tree is genuinely acyclic afterwards: walking up terminates.
    const rows = await prisma.category.findMany({
      where: { name: { contains: `Cyc ` } },
      select: { id: true, parentId: true },
    });
    const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
    for (const start of [a.id, b.id]) {
      const seen = new Set<string>();
      let cursor: string | null | undefined = start;
      while (cursor != null) {
        expect(seen.has(cursor)).toBe(false);
        seen.add(cursor);
        cursor = parentOf.get(cursor);
      }
    }
  }, 60_000);

  it('refuses a longer concurrent cycle', async () => {
    const a = await createCategory(admin, { name: `Chain A ${suffix}` });
    const b = await createCategory(admin, { name: `Chain B ${suffix}`, parentId: a.id });
    const c = await createCategory(admin, { name: `Chain C ${suffix}`, parentId: b.id });

    // A under C would close A→B→C→A.
    const results = await Promise.allSettled([
      updateCategory(admin, a.id, { parentId: c.id }),
      updateCategory(admin, c.id, { parentId: a.id }),
    ]);
    expect(results.some((r) => r.status === 'rejected')).toBe(true);

    const rows = await prisma.category.findMany({
      where: { name: { contains: `Chain ` } },
      select: { id: true, parentId: true },
    });
    const parentOf = new Map(rows.map((row) => [row.id, row.parentId]));
    const seen = new Set<string>();
    let cursor: string | null | undefined = a.id;
    while (cursor != null) {
      expect(seen.has(cursor)).toBe(false);
      seen.add(cursor);
      cursor = parentOf.get(cursor);
    }
  }, 60_000);
});
