import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Executable form of the Phase 1 schema checklist (docs/phase-1-plan.md,
 * Deliverable 3 + Definition of Done). These assertions read the live database,
 * so schema drift fails CI rather than review.
 */
const prisma = new PrismaClient();

function runSeed(): void {
  execFileSync('npx', ['tsx', 'prisma/seed.ts'], { stdio: 'pipe', env: process.env });
}

beforeAll(() => {
  runSeed();
});

afterAll(async () => {
  await prisma.$disconnect();
});

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
    runSeed();
    runSeed();

    expect(await prisma.store.count()).toBe(before);
    expect(await prisma.product.count()).toBe(24);
    expect(await prisma.storeProduct.count()).toBe(48);
    expect(await prisma.user.count()).toBe(5);
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

    const balances = new Map(
      items.map((item) => [`${item.storeId}:${item.productId}`, item.websiteStock]),
    );
    for (const entry of opening) {
      expect(entry.balanceAfter).toBe(balances.get(`${entry.storeId}:${entry.productId}`));
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
