/**
 * Prisma / SQL access for `stores`. Private to this module: nothing outside
 * `src/modules/stores` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * Read helpers take a `DbExecutor` so a caller inside a transaction can pass its
 * `Tx` handle and see its own uncommitted writes. Audited writes take a `Tx` and
 * nothing else — see `auditedExecutor` (§17).
 */
import {
  getPrisma,
  scopedWhere,
  type DbExecutor,
  type Principal,
  type Tx,
} from '../platform/index';
import type { AreaCandidate } from './domain/index';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

/**
 * The executor to run an *audited write* on.
 *
 * Deliberately has no `getPrisma()` fallback and takes the branded `Tx` that
 * only `withTransaction` can mint: a settings or zone change without its
 * `AuditLog` row in the same commit is the failure mode §3/§17 exists to
 * prevent. Passing the root client here is a compile error.
 */
export function auditedExecutor(tx: Tx): Tx {
  return tx;
}

export interface StoreRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly timezone: string;
  readonly isActive: boolean;
}

export interface SettingsRecord {
  readonly id: string;
  readonly storeId: string;
  readonly deliveryFeePaise: number;
  readonly minOrderPaise: number;
  readonly slotLengthMinutes: number;
  readonly slotCapacity: number;
  readonly substitutionPolicy: 'NONE' | 'ASK_CUSTOMER' | 'STAFF_DISCRETION';
  readonly posMode: 'MANUAL' | 'ADAPTER';
  readonly priceVariancePercentBp: number;
  readonly priceVarianceAbsCapPaise: number;
  readonly isAcceptingOrders: boolean;
  readonly lowStockThreshold: number;
}

const storeSelect = {
  id: true,
  code: true,
  name: true,
  timezone: true,
  isActive: true,
} as const;

/**
 * Stores the principal may see. Filtered here rather than by the caller: a
 * store-bound list that forgets its filter is an IDOR, so the module only owns
 * the filtered query.
 */
export async function listVisibleStores(
  principal: Principal,
  db?: DbExecutor,
): Promise<readonly StoreRecord[]> {
  return executor(db).store.findMany({
    where: scopedWhere(principal, {}, 'id'),
    select: storeSelect,
    orderBy: { code: 'asc' },
  });
}

/**
 * How many of the principal's stores are active and how many are not — a
 * `COUNT … GROUP BY isActive` under the same scope as `listVisibleStores`.
 * The overview used to show `stores.length` as "active stores", which counted
 * a deactivated shop as operating.
 */
export async function countVisibleStores(
  principal: Principal,
  db?: DbExecutor,
): Promise<{ active: number; inactive: number }> {
  const rows = await executor(db).store.groupBy({
    by: ['isActive'],
    where: scopedWhere(principal, {}, 'id'),
    _count: { _all: true },
  });
  let active = 0;
  let inactive = 0;
  for (const row of rows) {
    if (row.isActive) active += row._count._all;
    else inactive += row._count._all;
  }
  return { active, inactive };
}

export async function findStore(id: string, db?: DbExecutor): Promise<StoreRecord | null> {
  return executor(db).store.findUnique({ where: { id }, select: storeSelect });
}

export async function insertStore(
  tx: Tx,
  row: { code: string; name: string; addressJson: unknown; timezone?: string },
): Promise<StoreRecord> {
  return auditedExecutor(tx).store.create({
    data: {
      code: row.code,
      name: row.name,
      addressJson: row.addressJson as never,
      ...(row.timezone !== undefined ? { timezone: row.timezone } : {}),
      // Every store gets its settings row up front, so nothing downstream has to
      // cope with a store that has none.
      settings: { create: {} },
    },
    select: storeSelect,
  });
}

export async function updateStoreRow(
  tx: Tx,
  id: string,
  row: { name?: string; isActive?: boolean; timezone?: string; addressJson?: unknown },
): Promise<StoreRecord> {
  return auditedExecutor(tx).store.update({
    where: { id },
    data: {
      ...(row.name !== undefined ? { name: row.name } : {}),
      ...(row.isActive !== undefined ? { isActive: row.isActive } : {}),
      ...(row.timezone !== undefined ? { timezone: row.timezone } : {}),
      ...(row.addressJson !== undefined ? { addressJson: row.addressJson as never } : {}),
    },
    select: storeSelect,
  });
}

export async function findSettings(
  storeId: string,
  db?: DbExecutor,
): Promise<SettingsRecord | null> {
  return executor(db).storeSettings.findUnique({ where: { storeId } });
}

export async function updateSettingsRow(
  tx: Tx,
  storeId: string,
  data: Readonly<Record<string, unknown>>,
): Promise<SettingsRecord> {
  return auditedExecutor(tx).storeSettings.update({ where: { storeId }, data: data as never });
}

// ---------------------------------------------------------------------------
// Zones and areas
// ---------------------------------------------------------------------------

export interface ZoneRecord {
  readonly id: string;
  readonly storeId: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly sortKey: number;
}

export interface AreaRecord {
  readonly id: string;
  readonly zoneId: string;
  readonly name: string;
  readonly pincode: string | null;
  readonly matchHints: unknown;
  readonly isActive: boolean;
}

export async function listZones(
  principal: Principal,
  storeId: string | null,
  db?: DbExecutor,
): Promise<readonly ZoneRecord[]> {
  return executor(db).deliveryZone.findMany({
    where: scopedWhere(principal, storeId !== null ? { storeId } : {}),
    orderBy: [{ storeId: 'asc' }, { sortKey: 'asc' }],
  });
}

export async function findZone(id: string, db?: DbExecutor): Promise<ZoneRecord | null> {
  return executor(db).deliveryZone.findUnique({ where: { id } });
}

export async function insertZone(
  tx: Tx,
  row: { storeId: string; name: string; sortKey?: number },
): Promise<ZoneRecord> {
  return auditedExecutor(tx).deliveryZone.create({
    data: {
      storeId: row.storeId,
      name: row.name,
      ...(row.sortKey !== undefined ? { sortKey: row.sortKey } : {}),
    },
  });
}

export async function updateZoneRow(
  tx: Tx,
  id: string,
  row: { name?: string; isActive?: boolean; sortKey?: number },
): Promise<ZoneRecord> {
  return auditedExecutor(tx).deliveryZone.update({ where: { id }, data: { ...row } });
}

export async function listAreas(zoneId: string, db?: DbExecutor): Promise<readonly AreaRecord[]> {
  return executor(db).deliveryArea.findMany({ where: { zoneId }, orderBy: { name: 'asc' } });
}

/** The zone an area belongs to, and the store behind it — for scope checks. */
export async function findAreaWithStore(
  id: string,
  db?: DbExecutor,
): Promise<{ area: AreaRecord; storeId: string } | null> {
  const row = await executor(db).deliveryArea.findUnique({
    where: { id },
    include: { zone: { select: { storeId: true } } },
  });
  if (row === null) return null;
  const { zone, ...area } = row;
  return { area, storeId: zone.storeId };
}

export async function insertArea(
  tx: Tx,
  row: { zoneId: string; name: string; pincode: string | null; matchHints: readonly string[] },
): Promise<AreaRecord> {
  return auditedExecutor(tx).deliveryArea.create({
    data: {
      zoneId: row.zoneId,
      name: row.name,
      pincode: row.pincode,
      matchHints: row.matchHints as never,
    },
  });
}

export async function updateAreaRow(
  tx: Tx,
  id: string,
  row: {
    name?: string;
    pincode?: string | null;
    matchHints?: readonly string[];
    isActive?: boolean;
  },
): Promise<AreaRecord> {
  return auditedExecutor(tx).deliveryArea.update({
    where: { id },
    data: {
      ...(row.name !== undefined ? { name: row.name } : {}),
      ...(row.pincode !== undefined ? { pincode: row.pincode } : {}),
      ...(row.matchHints !== undefined ? { matchHints: row.matchHints as never } : {}),
      ...(row.isActive !== undefined ? { isActive: row.isActive } : {}),
    },
  });
}

/**
 * Every active area, flattened with its zone, store and that store's settings —
 * the input `resolveServiceability` decides from.
 *
 * Deliberately unscoped by principal: serviceability answers "which store serves
 * this address", so it has to see every store's areas. It returns no store data
 * beyond what a delivery quote needs.
 */
export async function loadAreaCandidates(db?: DbExecutor): Promise<readonly AreaCandidate[]> {
  const rows = await executor(db).deliveryArea.findMany({
    where: { isActive: true, zone: { isActive: true } },
    include: {
      zone: {
        select: {
          id: true,
          storeId: true,
          store: { select: { isActive: true, settings: true } },
        },
      },
    },
  });

  return rows.map((row) => {
    const settings = row.zone.store.settings;
    return {
      areaId: row.id,
      areaName: row.name,
      pincode: row.pincode,
      matchHints: toHints(row.matchHints),
      zoneId: row.zone.id,
      storeId: row.zone.storeId,
      storeIsActive: row.zone.store.isActive,
      isAcceptingOrders: settings?.isAcceptingOrders ?? false,
      deliveryFeePaise: settings?.deliveryFeePaise ?? 0,
      minOrderPaise: settings?.minOrderPaise ?? 0,
      slotLengthMinutes: settings?.slotLengthMinutes ?? 60,
      slotCapacity: settings?.slotCapacity ?? 0,
    };
  });
}

/** `matchHints` is free-form JSON; anything that is not a string array is none. */
function toHints(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

export async function insertServiceabilityRequest(
  rawInput: string,
  pincode: string | null,
  db?: DbExecutor,
): Promise<void> {
  await executor(db).serviceabilityRequest.create({ data: { rawInput, pincode } });
}
