import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Executable form of the Phase 1 schema checklist (docs/phase-1-plan.md,
 * Deliverable 3 + Definition of Done). These assertions read the live database,
 * so schema drift fails CI rather than review.
 *
 * ## Why this one file gets a database of its own
 *
 * Most of what follows asserts **totals** — 24 products, 2 stores, 5 users,
 * every stock balance explained by an opening-balance ledger row. Those are
 * statements about *a freshly seeded database*, and they were being asked of
 * whatever database happened to be lying around. In CI that is the same thing,
 * so CI was always green. Locally it is not: one e2e run leaves real `E2E…`
 * stores and imported products behind, and four assertions here then failed on
 * rows that were never the seed's doing. A developer learned to expect this
 * file to be red, which is the worst thing a schema-drift check can become.
 *
 * The alternative was to scope each assertion to rows the seed owns. That was
 * rejected: it quietly demotes "the seed produces exactly this and nothing
 * else" to "…at least this", and the surplus is precisely what a seed bug looks
 * like. Nothing here is weakened — the assertions below are unchanged. What
 * changed is that they are now asked of a database where they are literally
 * true: one created for this file, migrated, seeded, and dropped again.
 *
 * The shared database is never written to and never reset. `npm run test:integration`
 * on a developer's own database now leaves it exactly as it found it.
 */

/**
 * `schemacheck_` plus random bytes, never a fixed name.
 *
 * A deterministic name with "drop it first if it exists" is how one run
 * demolishes another run's database — two Vitest processes on one machine, or
 * two CI jobs against one server, are not prevented by this project's serial
 * config. The rule is: only ever drop a database this process created, and
 * `owned` below is the only thing that authorises that.
 */
const scratchDatabase = `schemacheck_${randomBytes(6).toString('hex')}`;

/** Belt and braces before the name reaches an identifier we cannot parameterise. */
if (!/^[a-z][a-z0-9_]{0,48}$/.test(scratchDatabase)) {
  throw new Error(`refusing to use "${scratchDatabase}" as a database name`);
}

/**
 * The same connection, pointed at a different database.
 *
 * Rebuilt from the base URL rather than string-spliced so credentials, host,
 * port and every query parameter (`connection_limit`, `sslmode`, …) survive —
 * a scratch database reached on different terms would not be testing the same
 * thing.
 */
function urlForDatabase(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const baseUrl = process.env.DATABASE_URL ?? '';

/**
 * An externally provisioned database, if the environment insists on one.
 *
 * The fallback for a role without CREATEDB is an *explicit* database someone
 * chose, never a silent demotion to the shared one — that would restore the
 * pollution this file exists to escape, and would start writing seed data into
 * a developer's own database again.
 */
const providedUrl = process.env.SCHEMA_TEST_DATABASE_URL ?? '';
const scratchUrl = providedUrl === '' ? urlForDatabase(baseUrl, scratchDatabase) : providedUrl;

/** Set only once `CREATE DATABASE` has actually succeeded. Authorises the drop. */
let owned: string | null = null;

/** Connected to the base database purely to issue CREATE/DROP; reads no rows. */
let admin: PrismaClient | null = null;

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: scratchUrl }) });

/** The child processes write to the scratch database, never to the shared one. */
const scratchEnv = { ...process.env, DATABASE_URL: scratchUrl };

/**
 * Run a CLI step against the scratch database, keeping its output.
 *
 * `execFileSync` throws a bare "Command failed" whose actual cause is on the
 * child's stderr, and a migration or seed that fails during setup must not
 * leave a reader guessing — nor may it pass for a test that ran.
 */
function runAgainstScratch(step: string, args: string[]): void {
  try {
    execFileSync('npx', args, { stdio: 'pipe', env: scratchEnv });
  } catch (error) {
    const detail = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `${step} failed against the scratch database ${scratchDatabase}\n` +
        `${detail.stdout?.toString() ?? ''}\n${detail.stderr?.toString() ?? ''}`,
    );
  }
}

function runSeed(): void {
  runAgainstScratch('seed', ['tsx', 'prisma/seed.ts']);
}

/** Disconnect first — PostgreSQL will not drop a database with a session on it. */
async function dropScratchDatabase(): Promise<void> {
  await prisma.$disconnect();
  if (admin !== null && owned !== null) {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${owned}"`);
    owned = null;
  }
  await admin?.$disconnect();
  admin = null;
}

beforeAll(async () => {
  if (baseUrl === '' && providedUrl === '') {
    throw new Error('DATABASE_URL is required to provision this file’s scratch database');
  }

  try {
    if (providedUrl === '') {
      admin = new PrismaClient({ adapter: new PrismaPg({ connectionString: baseUrl }) });
      try {
        await admin.$executeRawUnsafe(`CREATE DATABASE "${scratchDatabase}"`);
      } catch (error) {
        throw new Error(
          `could not create the scratch database ${scratchDatabase}. This file needs a role ` +
            'with CREATEDB, or an explicit SCHEMA_TEST_DATABASE_URL pointing at a database it ' +
            `may own outright. It will not fall back to the shared one.\n${String(error)}`,
        );
      }
      owned = scratchDatabase;
      runAgainstScratch('prisma migrate deploy', ['prisma', 'migrate', 'deploy']);
    }
    runSeed();
  } catch (error) {
    // A half-provisioned database must not outlive the failure that made it.
    await dropScratchDatabase();
    throw error;
  }
}, 120_000);

afterAll(async () => {
  await dropScratchDatabase();
});

/**
 * Every row the seed is responsible for, in a stable order and without
 * `updatedAt`.
 *
 * `updatedAt` is dropped because it is the one column an *idempotent* seed
 * legitimately moves: the seed upserts, so a re-run writes identical values
 * and Prisma's `@updatedAt` bumps anyway. Nothing else is excused. `id` and
 * `createdAt` in particular stay in, because a row quietly deleted and
 * re-created — the failure that leaves every count identical — shows up there
 * and nowhere else.
 *
 * Only sound because the database under test was created for this file: on a
 * shared one, another test's rows would make this compare unrelated things.
 */
async function seededRows(): Promise<unknown> {
  const by = { orderBy: { id: 'asc' } } as const;
  const stable = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
    rows.map(({ updatedAt: _updatedAt, ...rest }) => rest);

  return {
    stores: stable(await prisma.store.findMany(by)),
    settings: stable(await prisma.storeSettings.findMany(by)),
    products: stable(await prisma.product.findMany(by)),
    storeProducts: stable(await prisma.storeProduct.findMany(by)),
    inventory: stable(await prisma.inventoryItem.findMany(by)),
    users: stable(await prisma.user.findMany(by)),
    areas: stable(await prisma.deliveryArea.findMany(by)),
  };
}

async function columnsOf(
  table: string,
): Promise<Map<string, { nullable: string; default: string | null }>> {
  const rows = await prisma.$queryRaw<
    { column_name: string; is_nullable: string; column_default: string | null }[]
  >`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return new Map(
    rows.map((row) => [
      row.column_name,
      { nullable: row.is_nullable, default: row.column_default },
    ]),
  );
}

async function enumValues(enumName: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ label: string }[]>`
    SELECT e.enumlabel AS label
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = ${enumName}
    ORDER BY e.enumsortorder
  `;
  return rows.map((row) => row.label);
}

describe('migrations + seed', () => {
  it('leaves no pending migrations', async () => {
    const rows = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations"
      WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL
    `;
    expect(Number(rows[0]?.count ?? 0n)).toBe(0);
  });

  it('is re-runnable without error or duplication', async () => {
    const before = await prisma.store.count();
    const rowsBefore = await seededRows();
    runSeed();
    runSeed();

    expect(await prisma.store.count()).toBe(before);
    expect(await prisma.product.count()).toBe(24);
    expect(await prisma.storeProduct.count()).toBe(48);
    expect(await prisma.user.count()).toBe(5);

    // Counts alone only see rows appearing. A seed that *rewrote* a price, or
    // deleted a row and re-created it under a new id, or drifted a stock level,
    // leaves the totals untouched and would sail through — and this database
    // belongs to this file alone, so the whole contents are a fair comparison.
    expect(await seededRows()).toEqual(rowsBefore);
  });

  /**
   * R8 — `ProductImage` has no natural key, so `upsert` is not available and the
   * obvious "create the seed's photos" writes a fresh duplicate set on every
   * run. Counted after two seeds because one proves nothing.
   */
  it('gives the image-bearing products their photos exactly once', async () => {
    runSeed();
    runSeed();

    const seeded = await prisma.productImage.findMany({
      where: { url: { startsWith: '/seed/products/' } },
      select: { url: true, productId: true, alt: true },
    });
    expect(seeded).toHaveLength(4);
    expect(new Set(seeded.map((row) => row.productId)).size).toBe(4);
    // Served from `public/`, not somebody else's CDN: a demo database that
    // needs the internet to look right is one that looks broken on a train.
    expect(seeded.every((row) => row.url.endsWith('.svg'))).toBe(true);
    expect(seeded.every((row) => (row.alt ?? '') !== '')).toBe(true);
  });

  it('seeds two stores with independently editable settings', async () => {
    const settings = await prisma.storeSettings.findMany({
      include: { store: true },
      orderBy: { store: { code: 'asc' } },
    });

    expect(settings).toHaveLength(2);
    expect(settings[0]?.slotLengthMinutes).toBe(60);
    expect(settings[0]?.priceVariancePercentBp).toBe(500);
    expect(settings[0]?.priceVarianceAbsCapPaise).toBe(5000);
    expect(settings[0]?.posMode).toBe('MANUAL');
    // Capacity is per store, and the two stores differ.
    expect(settings[0]?.slotCapacity).not.toBe(settings[1]?.slotCapacity);
  });

  it('lists partly overlapping catalogues at different prices per store', async () => {
    const listedPerStore = await prisma.storeProduct.groupBy({
      by: ['storeId'],
      where: { isListed: true },
      _count: true,
    });
    expect(listedPerStore).toHaveLength(2);
    for (const group of listedPerStore) {
      // Each store leaves two products off its shelves, so neither catalogue is
      // the whole master.
      expect(group._count).toBeLessThan(24);
    }

    // The same global Product is listed by both stores at different prices.
    const shared = await prisma.product.findFirstOrThrow({
      where: { sku: '8901234500028' },
      include: { storeProducts: true },
    });
    expect(shared.storeProducts).toHaveLength(2);
    expect(shared.storeProducts[0]?.sellingPricePaise).not.toBe(
      shared.storeProducts[1]?.sellingPricePaise,
    );
  });

  it('seeds one SUPER_ADMIN plus a manager and staff member per store', async () => {
    expect(await prisma.user.count({ where: { role: 'SUPER_ADMIN', storeId: null } })).toBe(1);
    expect(await prisma.user.count({ where: { role: 'STORE_MANAGER' } })).toBe(2);
    expect(await prisma.user.count({ where: { role: 'STORE_STAFF' } })).toBe(2);
  });
});

describe('schema invariants (Phase 1 Definition of Done)', () => {
  it('has websiteStock as the single quantity — no reservedQty', async () => {
    const columns = await columnsOf('InventoryItem');

    expect(columns.has('websiteStock')).toBe(true);
    expect(columns.has('reservedQty')).toBe(false);
    expect([...columns.keys()].some((name) => /reserv/i.test(name))).toBe(false);
  });

  it('has the full StockLedger reason set and a balanceAfter column', async () => {
    expect(await enumValues('StockLedgerReason')).toEqual([
      'MANUAL_ADJUST',
      'CSV_IMPORT',
      'RECONCILE',
      'ORDER_PLACED',
      'PICK_SHORT_RESTORE',
      'ADMIN_CORRECTION',
      'POS_SYNC',
    ]);
    expect((await columnsOf('StockLedger')).has('balanceAfter')).toBe(true);
  });

  it('keeps DeliveryArea.pincode nullable and non-unique, with an index', async () => {
    const columns = await columnsOf('DeliveryArea');
    expect(columns.get('pincode')?.nullable).toBe('YES');

    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'DeliveryArea'
    `;
    const pincodeIndexes = indexes.filter((row) => row.indexdef.includes('(pincode)'));
    expect(pincodeIndexes.length).toBeGreaterThan(0);
    for (const index of pincodeIndexes) {
      expect(index.indexdef).not.toContain('UNIQUE');
    }
  });

  it('lets two areas under different stores share one pincode (ADR-0004)', async () => {
    const areas = await prisma.deliveryArea.findMany({
      where: { pincode: '560041' },
      include: { zone: { include: { store: true } } },
    });

    expect(areas).toHaveLength(2);
    const storeIds = new Set(areas.map((area) => area.zone.storeId));
    expect(storeIds.size).toBe(2);
  });

  it('has an order status enum with no customer-cancel value', async () => {
    const values = await enumValues('OrderStatus');

    expect(values).toContain('CANCELLED_BY_STORE');
    expect(values).toContain('DELIVERY_FAILED');
    expect(values).toContain('CLOSED_UNDELIVERED');
    expect(values.some((value) => /CANCELLED_BY_CUSTOMER|CUSTOMER_CANCEL/i.test(value))).toBe(
      false,
    );
  });

  it('has the price-variance fields on Order and a unique trackingToken', async () => {
    const columns = await columnsOf('Order');
    for (const column of [
      'trackingToken',
      'priceVarianceFlagged',
      'customerConfirmedRevisedAmount',
      'revisedAmountConfirmedBy',
      'posBillNumber',
      'posFinalTotalPaise',
    ]) {
      expect(columns.has(column)).toBe(true);
    }

    const indexes = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'Order'
    `;
    expect(
      indexes.some(
        (row) => row.indexdef.includes('UNIQUE') && row.indexdef.includes('("trackingToken")'),
      ),
    ).toBe(true);
  });

  it('defaults OrderLine.stockRestoredQty to 0', async () => {
    const columns = await columnsOf('OrderLine');
    expect(columns.get('stockRestoredQty')?.default).toBe('0');
  });

  it('keeps Customer.email and Customer.passwordHash nullable (guest-first)', async () => {
    const columns = await columnsOf('Customer');
    expect(columns.get('email')?.nullable).toBe('YES');
    expect(columns.get('passwordHash')?.nullable).toBe('YES');
    expect(columns.get('phone')?.nullable).toBe('NO');
  });

  it('seeds customer_otp_login as disabled', async () => {
    const flag = await prisma.featureFlag.findUniqueOrThrow({
      where: { key: 'customer_otp_login' },
    });
    expect(flag.enabled).toBe(false);
  });

  it('has the PosSkuMap table reserved for a future POS adapter', async () => {
    expect((await columnsOf('PosSkuMap')).has('posSku')).toBe(true);
    expect(await prisma.posSkuMap.count()).toBe(0);
  });

  // R6: §3/§7 — no stock balance may exist without a ledger row explaining it.
  // The seed used to create 40 InventoryItem rows and 0 StockLedger rows.
  it('explains every seeded stock balance with an opening-balance ledger row', async () => {
    const items = await prisma.inventoryItem.findMany();
    const opening = await prisma.stockLedger.findMany({ where: { refId: 'opening-balance' } });

    expect(items.length).toBeGreaterThan(0);
    expect(opening).toHaveLength(items.length);

    for (const entry of opening) {
      expect(entry.reason).toBe('RECONCILE');
      expect(entry.actorType).toBe('SYSTEM');
      expect(entry.delta).toBe(entry.balanceAfter);
    }

    // The opening row explains the *opening* balance, not necessarily the
    // current one: the seed's demo orders now take stock and write their own
    // `ORDER_PLACED` rows (OSCAR R4), so a shelf can legitimately sit below
    // where it started. What §3 actually requires is stronger and is what is
    // asserted here — **every** balance is the sum of every movement recorded
    // against it. A shelf that moved without a ledger row fails this; one that
    // moved with one does not.
    for (const item of items) {
      const movements = await prisma.stockLedger.findMany({
        where: { storeId: item.storeId, productId: item.productId },
      });
      expect(movements.reduce((sum, entry) => sum + entry.delta, 0)).toBe(item.websiteStock);
    }
  });

  it('does not mint a second opening balance when the seed is re-run', async () => {
    const before = await prisma.stockLedger.count({ where: { refId: 'opening-balance' } });
    const stockBefore = await prisma.inventoryItem.aggregate({ _sum: { websiteStock: true } });

    runSeed();

    expect(await prisma.stockLedger.count({ where: { refId: 'opening-balance' } })).toBe(before);
    expect(
      (await prisma.inventoryItem.aggregate({ _sum: { websiteStock: true } }))._sum.websiteStock,
    ).toBe(stockBefore._sum.websiteStock);
  });
});
