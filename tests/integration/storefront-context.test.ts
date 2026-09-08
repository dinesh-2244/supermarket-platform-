import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import {
  captureServiceabilityRequest,
  getSettings,
  getStore,
  getStorefrontSettings,
  listServiceableAreas,
  resolveServiceability,
} from '@/modules/stores';
import { listProducts } from '@/modules/catalog';
import { listListings } from '@/modules/pricing';
import { availabilityFor, getStock, listLedger, listStock } from '@/modules/inventory';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * P3-1 — store context, and what a storefront principal may read.
 *
 * The regression this file exists to hold is the shared-pincode one: two areas
 * under *different* stores with the *same* pincode must each resolve to their
 * own store. Getting that wrong sells one shop's stock at the other's prices.
 */
const prisma = getPrisma();
const suffix = `${Date.now() % 1000000}`;
const PINCODE = `5${suffix.slice(-5)}`;

let storeA: string;
let storeB: string;
let areaA: string;
let areaB: string;
let closedArea: string;
let storeClosed: string;

async function makeZoneAndArea(
  storeId: string,
  name: string,
  pincode: string | null,
): Promise<string> {
  const zone = await prisma.deliveryZone.create({ data: { storeId, name: `${name} zone` } });
  const area = await prisma.deliveryArea.create({
    data: { zoneId: zone.id, name, pincode },
  });
  return area.id;
}

beforeAll(async () => {
  const a = await createStore(prisma, { code: `SFA-${suffix.slice(-5)}` });
  const b = await createStore(prisma, { code: `SFB-${suffix.slice(-5)}` });
  const closed = await createStore(prisma, { code: `SFC-${suffix.slice(-5)}` });
  storeA = a.id;
  storeB = b.id;
  storeClosed = closed.id;

  await createStoreSettings(prisma, storeA);
  await createStoreSettings(prisma, storeB);
  await createStoreSettings(prisma, storeClosed, { isAcceptingOrders: false });

  // The same pincode, under two different stores.
  areaA = await makeZoneAndArea(storeA, `Alpha ${suffix}`, PINCODE);
  areaB = await makeZoneAndArea(storeB, `Bravo ${suffix}`, PINCODE);
  closedArea = await makeZoneAndArea(storeClosed, `Charlie ${suffix}`, PINCODE);
});

afterAll(async () => {
  const stores = [storeA, storeB, storeClosed];
  await prisma.serviceabilityRequest.deleteMany({ where: { rawInput: { contains: suffix } } });
  await prisma.deliveryArea.deleteMany({ where: { zone: { storeId: { in: stores } } } });
  await prisma.deliveryZone.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.$disconnect();
});

/** A guest whose area resolved to `storeId`; no account, ever. */
function shopper(storeId: string | null): Principal {
  return { kind: 'customer', customerId: null, storeId };
}

describe('P3-1 — the picker and store binding', () => {
  it('lists only areas of active stores, with no business data attached', async () => {
    const areas = await listServiceableAreas();
    const ids = areas.map((area) => area.areaId);
    expect(ids).toContain(areaA);
    expect(ids).toContain(areaB);

    const one = areas.find((area) => area.areaId === areaA);
    // Exactly the routing facts the picker needs — no fee, no minimum, no zone.
    expect(Object.keys(one ?? {}).sort()).toEqual([
      'areaId',
      'areaName',
      'isAcceptingOrders',
      'pincode',
      'storeId',
    ]);
  });

  it('marks an area whose store has paused orders, rather than hiding it', async () => {
    const areas = await listServiceableAreas();
    const paused = areas.find((area) => area.areaId === closedArea);
    expect(paused?.isAcceptingOrders).toBe(false);
    // …and it genuinely cannot become a store context.
    expect(await resolveServiceability({ areaId: closedArea })).toEqual({
      servable: false,
      reason: 'store-closed',
    });
  });

  /** The regression guard the plan asks for by name. */
  it('resolves two same-pincode areas to their own stores', async () => {
    const first = await resolveServiceability({ areaId: areaA });
    const second = await resolveServiceability({ areaId: areaB });

    expect(first).toMatchObject({ servable: true, storeId: storeA, areaId: areaA });
    expect(second).toMatchObject({ servable: true, storeId: storeB, areaId: areaB });
    expect(first.servable && second.servable && first.storeId === second.storeId).toBe(false);
  });

  it('refuses an area id that is not real, rather than guessing a store', async () => {
    expect(await resolveServiceability({ areaId: 'not-an-area' })).toEqual({
      servable: false,
      reason: 'unknown-area',
    });
    expect(await resolveServiceability({})).toEqual({ servable: false, reason: 'no-input' });
  });

  it('captures an out-of-zone visitor as a demand signal', async () => {
    await captureServiceabilityRequest({ pincode: '999999', locality: `Nowhere ${suffix}` });
    const rows = await prisma.serviceabilityRequest.findMany({
      where: { rawInput: { contains: suffix } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.pincode).toBe('999999');
  });

  it('refuses to record an empty demand signal', async () => {
    await expect(captureServiceabilityRequest({})).rejects.toThrow(/nothing to record/i);
  });
});

describe('P3-1 — what a storefront principal may read', () => {
  it('reads its own store, listings and display settings', async () => {
    const principal = shopper(storeA);
    await expect(getStore(principal, storeA)).resolves.toMatchObject({ id: storeA });
    await expect(listListings(principal, { storeId: storeA })).resolves.toBeInstanceOf(Array);
    // The master is global — a slug resolves the same everywhere (§8).
    await expect(listProducts(principal)).resolves.toBeInstanceOf(Array);

    const settings = await getStorefrontSettings(principal, storeA);
    expect(Object.keys(settings).sort()).toEqual([
      'deliveryFeePaise',
      'isAcceptingOrders',
      'minOrderPaise',
      'slotCapacity',
      'slotLengthMinutes',
      'storeId',
    ]);
  });

  /**
   * The grant says a shopper may read their store's settings and inventory; the
   * *shape* is what stops that becoming a live stock feed and an operations
   * dump. Both halves are needed, so both are asserted.
   */
  it('is refused the back-office shapes of the things it may read', async () => {
    const principal = shopper(storeA);
    // Carries posMode, substitutionPolicy and the variance thresholds.
    await expect(getSettings(principal, storeA)).rejects.toThrow(/permission/i);
    // Carries raw websiteStock.
    await expect(listStock(principal, { storeId: storeA })).rejects.toThrow(/permission/i);
    await expect(getStock(principal, storeA, 'anything')).rejects.toThrow(/permission/i);
    // …and the movement history is not granted at all.
    await expect(listLedger(principal, { storeId: storeA })).rejects.toThrow(/permission/i);

    // What it gets instead: a band, and a count only when the count is urgency.
    const bands = await availabilityFor(principal, storeA, ['never-stocked']);
    expect(bands.get('never-stocked')).toEqual({
      productId: 'never-stocked',
      availability: 'OUT_OF_STOCK',
      remaining: 0,
    });
  });

  it('cannot read the other store, whatever it asks for', async () => {
    const principal = shopper(storeA);
    await expect(getStore(principal, storeB)).rejects.toThrow(/permission/i);
    await expect(getStorefrontSettings(principal, storeB)).rejects.toThrow(/permission/i);
    await expect(listListings(principal, { storeId: storeB })).rejects.toThrow(/permission/i);
    await expect(availabilityFor(principal, storeB, ['x'])).rejects.toThrow(/permission/i);
  });

  it('gives a visitor with no area chosen nothing store-scoped', async () => {
    const visitor = shopper(null);
    await expect(getStore(visitor, storeA)).rejects.toThrow(/permission/i);
    await expect(listListings(visitor, { storeId: storeA })).rejects.toThrow(/permission/i);
    await expect(availabilityFor(visitor, storeA, ['x'])).rejects.toThrow(/permission/i);
  });

  /**
   * The headline invariant of the phase, at its cheapest point: the principal
   * the storefront runs as has no write grant at all, so a storefront code path
   * that tried to move stock would be denied before it reached the ledger.
   */
  it('has no grant that could write stock or a price', async () => {
    const { adjustStock, reconcileStock } = await import('@/modules/inventory');
    const { setPrice, setListed } = await import('@/modules/pricing');
    const principal = shopper(storeA);
    const productId = 'does-not-matter';

    await expect(adjustStock(principal, { storeId: storeA, productId, delta: 1 })).rejects.toThrow(
      /permission/i,
    );
    await expect(
      reconcileStock(principal, { storeId: storeA, productId, counted: 1 }),
    ).rejects.toThrow(/permission/i);
    await expect(
      setPrice(principal, storeA, productId, { mrpPaise: 100, sellingPricePaise: 100 }),
    ).rejects.toThrow(/permission/i);
    await expect(setListed(principal, storeA, productId, true)).rejects.toThrow(/permission/i);

    // Nothing reached the database on any of those paths.
    expect(await prisma.stockLedger.count({ where: { storeId: storeA } })).toBe(0);
    expect(await prisma.storeProduct.count({ where: { storeId: storeA } })).toBe(0);
  });
});
