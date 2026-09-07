import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import {
  createArea,
  createZone,
  getSettings,
  listStores,
  listZones,
  resolveServiceability,
  updateArea,
  updatePosMode,
  updateSettings,
  updateStore,
  updateZone,
} from '@/modules/stores';
import { createStore, createStoreSettings } from '../factories/index';

/**
 * P2-2 — store settings and delivery geography against a real database.
 *
 * The unit suite proves `resolveServiceability` as a pure function; this proves
 * the query behind it loads what the function needs, and that a manager is
 * refused another store's settings and zones *server-side* rather than merely
 * not being shown them.
 */
const prisma = getPrisma();
const SHARED_PINCODE = '561111';

let storeA: string;
let storeB: string;
let zoneA: string;
let zoneB: string;
let admin: Principal;
let managerA: Principal;
let managerB: Principal;
let staffA: Principal;

beforeAll(async () => {
  const suffix = Date.now() % 100000;
  const a = await createStore(prisma, { code: `STA-${suffix}`, name: 'Store A' });
  const b = await createStore(prisma, { code: `STB-${suffix}`, name: 'Store B' });
  storeA = a.id;
  storeB = b.id;
  await createStoreSettings(prisma, storeA);
  await createStoreSettings(prisma, storeB);

  admin = { kind: 'user', userId: 'admin-1', role: 'SUPER_ADMIN', storeId: null };
  managerA = { kind: 'user', userId: 'mgr-a', role: 'STORE_MANAGER', storeId: storeA };
  managerB = { kind: 'user', userId: 'mgr-b', role: 'STORE_MANAGER', storeId: storeB };
  staffA = { kind: 'user', userId: 'stf-a', role: 'STORE_STAFF', storeId: storeA };

  zoneA = (await createZone(managerA, { storeId: storeA, name: 'A North' })).id;
  zoneB = (await createZone(managerB, { storeId: storeB, name: 'B South' })).id;

  // The ADR-0004 shape: one pincode, two areas, two different stores.
  await createArea(managerA, {
    zoneId: zoneA,
    name: `Alpha ${suffix}`,
    pincode: SHARED_PINCODE,
    matchHints: [`Alpha Layout ${suffix}`],
  });
  await createArea(managerB, {
    zoneId: zoneB,
    name: `Beta ${suffix}`,
    pincode: SHARED_PINCODE,
  });
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.auditLog.deleteMany({ where: { actorId: { in: ['admin-1', 'mgr-a', 'mgr-b'] } } });
  await prisma.deliveryArea.deleteMany({ where: { zone: { storeId: { in: stores } } } });
  await prisma.deliveryZone.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeSettings.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.$disconnect();
});

describe('stores — serviceability against real rows', () => {
  it('routes two same-pincode areas under different stores to their own store', async () => {
    const suffix = (
      await prisma.deliveryArea.findFirstOrThrow({ where: { pincode: SHARED_PINCODE } })
    ).name.split(' ')[1];

    const a = await resolveServiceability({ locality: `Alpha ${suffix}` });
    const b = await resolveServiceability({ locality: `Beta ${suffix}` });

    expect(a).toMatchObject({ servable: true, storeId: storeA });
    expect(b).toMatchObject({ servable: true, storeId: storeB });
  });

  it('is out of zone for an address nobody covers', async () => {
    await expect(resolveServiceability({ locality: 'Nowhere At All' })).resolves.toEqual({
      servable: false,
      reason: 'out-of-zone',
    });
  });

  it('drops an area once it is deactivated', async () => {
    const area = await prisma.deliveryArea.findFirstOrThrow({
      where: { zoneId: zoneA, isActive: true },
    });
    await updateArea(managerA, area.id, { isActive: false });

    const result = await resolveServiceability({ areaId: area.id });
    expect(result).toEqual({ servable: false, reason: 'unknown-area' });

    await updateArea(managerA, area.id, { isActive: true });
  });
});

describe('stores — cross-store denial (server-side)', () => {
  it('refuses a manager another store’s settings, read and write', async () => {
    await expect(getSettings(managerA, storeB)).rejects.toThrow(/permission/i);
    await expect(updateSettings(managerA, storeB, { deliveryFeePaise: 1 })).rejects.toThrow(
      /permission/i,
    );
    // …and allows their own, so the refusal is about the store.
    await expect(
      updateSettings(managerA, storeA, { deliveryFeePaise: 4200 }),
    ).resolves.toMatchObject({ deliveryFeePaise: 4200 });
  });

  it('refuses a manager posMode — it selects the POS implementation (ADR-0007)', async () => {
    await expect(updatePosMode(managerA, storeA, 'ADAPTER')).rejects.toThrow(/permission/i);
    await expect(updatePosMode(admin, storeA, 'ADAPTER')).resolves.toMatchObject({
      posMode: 'ADAPTER',
    });
    await updatePosMode(admin, storeA, 'MANUAL');
  });

  it('refuses a manager store create/update — those are SUPER_ADMIN only', async () => {
    await expect(updateStore(managerA, storeA, { name: 'Renamed' })).rejects.toThrow(/permission/i);
    await expect(updateStore(admin, storeA, { name: 'Store A' })).resolves.toMatchObject({
      name: 'Store A',
    });
  });

  it('refuses a manager another store’s zones and areas', async () => {
    await expect(createZone(managerA, { storeId: storeB, name: 'Sneaky' })).rejects.toThrow(
      /permission/i,
    );
    await expect(updateZone(managerA, zoneB, { name: 'Sneaky' })).rejects.toThrow(/permission/i);
    await expect(createArea(managerA, { zoneId: zoneB, name: 'Sneaky Area' })).rejects.toThrow(
      /permission/i,
    );

    const areaB = await prisma.deliveryArea.findFirstOrThrow({ where: { zoneId: zoneB } });
    await expect(updateArea(managerA, areaB.id, { name: 'Sneaky' })).rejects.toThrow(/permission/i);
  });

  // The scope check reads the zone's own store from the database rather than
  // trusting a store id in the request — so a forged one changes nothing.
  it('scopes a zone update on the zone’s real store, not a supplied id', async () => {
    await expect(updateZone(managerB, zoneA, { name: 'Forged' })).rejects.toThrow(/permission/i);
    const untouched = await prisma.deliveryZone.findUniqueOrThrow({ where: { id: zoneA } });
    expect(untouched.name).toBe('A North');
  });

  it('shows a manager only their own store in every list', async () => {
    expect((await listStores(managerA)).map((s) => s.id)).toEqual([storeA]);
    expect((await listZones(managerA)).every((z) => z.storeId === storeA)).toBe(true);

    const allStores = (await listStores(admin)).map((s) => s.id);
    expect(allStores).toContain(storeA);
    expect(allStores).toContain(storeB);
  });

  it('lets staff read but never write', async () => {
    await expect(getSettings(staffA, storeA)).resolves.toMatchObject({ storeId: storeA });
    await expect(updateSettings(staffA, storeA, { deliveryFeePaise: 1 })).rejects.toThrow(
      /permission/i,
    );
    await expect(createZone(staffA, { storeId: storeA, name: 'Nope' })).rejects.toThrow(
      /permission/i,
    );
  });
});

describe('stores — audit', () => {
  it('writes a before/after row for a settings change', async () => {
    const before = await getSettings(admin, storeB);
    await updateSettings(admin, storeB, { minOrderPaise: 55_000 });

    const entry = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: 'StoreSettings', entityId: before.id },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry.action).toBe('update');
    expect(entry.beforeJson).toMatchObject({ minOrderPaise: before.minOrderPaise });
    expect(entry.afterJson).toMatchObject({ minOrderPaise: 55_000 });
  });

  it('rejects a non-integer fee before it reaches the database', async () => {
    await expect(updateSettings(admin, storeB, { deliveryFeePaise: 30.5 })).rejects.toThrow(
      /whole number/i,
    );
  });
});
