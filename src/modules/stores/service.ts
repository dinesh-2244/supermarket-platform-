/**
 * Use-cases for `stores`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 */
import {
  assertAuthorized,
  ConflictError,
  NotFoundError,
  Prisma,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type Principal,
} from '../platform/index';
import {
  assertEditableSettings,
  assertOptionalPincode,
  assertRequiredName,
  assertStoreCode,
  descriptor,
  resolveServiceabilityFrom,
  type EditableSettings,
  type ModuleDescriptor,
  type ServiceabilityInput,
  type ServiceabilityResult,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type { AreaRecord, SettingsRecord, StoreRecord, ZoneRecord } from './repo';

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export async function listStores(principal: Principal): Promise<readonly repo.StoreRecord[]> {
  assertAuthorized(principal, 'store:read', { type: 'Store', storeId: scopeOf(principal) });
  return repo.listVisibleStores(principal);
}

export async function getStore(principal: Principal, storeId: string): Promise<repo.StoreRecord> {
  const store = await repo.findStore(storeId);
  if (store === null) throw new NotFoundError('Store not found', { storeId });
  assertAuthorized(principal, 'store:read', { type: 'Store', id: storeId, storeId });
  return store;
}

export interface CreateStoreInput {
  readonly code: string;
  readonly name: string;
  readonly addressJson: unknown;
  readonly timezone?: string;
}

export async function createStore(
  principal: Principal,
  input: CreateStoreInput,
): Promise<repo.StoreRecord> {
  // Creating a store is unscoped by nature — there is no store to be scoped to
  // yet — so only a SUPER_ADMIN holds this grant.
  assertAuthorized(principal, 'store:create', { type: 'Store' });
  const code = assertStoreCode(input.code);
  const name = assertRequiredName(input.name);

  return withTransaction(async (tx) => {
    const store = await repo
      .insertStore(tx, {
        code,
        name,
        addressJson: input.addressJson,
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictError('A store with that code already exists', { code });
        }
        throw error;
      });

    await writeAuditLog(tx, {
      principal,
      action: 'create',
      entityType: 'Store',
      entityId: store.id,
      after: store,
    });
    return store;
  });
}

export interface UpdateStoreInput {
  readonly name?: string;
  readonly isActive?: boolean;
  readonly timezone?: string;
  readonly addressJson?: unknown;
}

export async function updateStore(
  principal: Principal,
  storeId: string,
  input: UpdateStoreInput,
): Promise<repo.StoreRecord> {
  const before = await repo.findStore(storeId);
  if (before === null) throw new NotFoundError('Store not found', { storeId });
  assertAuthorized(principal, 'store:update', { type: 'Store', id: storeId, storeId });

  return withTransaction(async (tx) => {
    const after = await repo.updateStoreRow(tx, storeId, {
      ...(input.name !== undefined ? { name: assertRequiredName(input.name) } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.addressJson !== undefined ? { addressJson: input.addressJson } : {}),
    });
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'Store',
      entityId: storeId,
      before,
      after,
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(
  principal: Principal,
  storeId: string,
): Promise<repo.SettingsRecord> {
  assertAuthorized(principal, 'store-settings:read', { type: 'StoreSettings', storeId });
  const settings = await repo.findSettings(storeId);
  if (settings === null) throw new NotFoundError('Store settings not found', { storeId });
  return settings;
}

/**
 * Edit a store's business settings.
 *
 * `posMode` is deliberately **not** in `EditableSettings`: it selects which POS
 * implementation the store runs (ADR-0007) and is a platform decision, so it has
 * its own grant and its own function below. A manager editing their own delivery
 * fee must not be able to switch the store onto an adapter.
 */
export async function updateSettings(
  principal: Principal,
  storeId: string,
  input: EditableSettings,
): Promise<repo.SettingsRecord> {
  assertAuthorized(principal, 'store-settings:update', { type: 'StoreSettings', storeId });
  assertEditableSettings(input);

  const before = await repo.findSettings(storeId);
  if (before === null) throw new NotFoundError('Store settings not found', { storeId });

  const data = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
  if (Object.keys(data).length === 0) return before;

  return withTransaction(async (tx) => {
    const after = await repo.updateSettingsRow(tx, storeId, data);
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'StoreSettings',
      entityId: after.id,
      before,
      after,
    });
    return after;
  });
}

/** Switch a store between the manual POS workflow and a future adapter. */
export async function updatePosMode(
  principal: Principal,
  storeId: string,
  posMode: 'MANUAL' | 'ADAPTER',
): Promise<repo.SettingsRecord> {
  assertAuthorized(principal, 'store-settings:update-pos-mode', {
    type: 'StoreSettings',
    storeId,
  });
  const before = await repo.findSettings(storeId);
  if (before === null) throw new NotFoundError('Store settings not found', { storeId });

  return withTransaction(async (tx) => {
    const after = await repo.updateSettingsRow(tx, storeId, { posMode });
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'StoreSettings',
      entityId: after.id,
      before: { posMode: before.posMode },
      after: { posMode: after.posMode },
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Zones and areas
// ---------------------------------------------------------------------------

export async function listZones(
  principal: Principal,
  storeId: string | null = null,
): Promise<readonly repo.ZoneRecord[]> {
  assertAuthorized(principal, 'delivery-zone:read', {
    type: 'DeliveryZone',
    storeId: storeId ?? scopeOf(principal),
  });
  return repo.listZones(principal, storeId);
}

export async function createZone(
  principal: Principal,
  input: { storeId: string; name: string; sortKey?: number },
): Promise<repo.ZoneRecord> {
  assertAuthorized(principal, 'delivery-zone:write', {
    type: 'DeliveryZone',
    storeId: input.storeId,
  });
  const name = assertRequiredName(input.name, 'Zone name');

  return withTransaction(async (tx) => {
    const zone = await repo
      .insertZone(tx, {
        storeId: input.storeId,
        name,
        ...(input.sortKey !== undefined ? { sortKey: input.sortKey } : {}),
      })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictError('That store already has a zone with this name', { name });
        }
        throw error;
      });

    await writeAuditLog(tx, {
      principal,
      action: 'create',
      entityType: 'DeliveryZone',
      entityId: zone.id,
      after: zone,
    });
    return zone;
  });
}

export async function updateZone(
  principal: Principal,
  zoneId: string,
  input: { name?: string; isActive?: boolean; sortKey?: number },
): Promise<repo.ZoneRecord> {
  const before = await repo.findZone(zoneId);
  if (before === null) throw new NotFoundError('Delivery zone not found', { zoneId });
  // Scoped on the zone's *own* store, read from the database — never on a store
  // id supplied by the caller.
  assertAuthorized(principal, 'delivery-zone:write', {
    type: 'DeliveryZone',
    id: zoneId,
    storeId: before.storeId,
  });

  return withTransaction(async (tx) => {
    const after = await repo.updateZoneRow(tx, zoneId, {
      ...(input.name !== undefined ? { name: assertRequiredName(input.name, 'Zone name') } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.sortKey !== undefined ? { sortKey: input.sortKey } : {}),
    });
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'DeliveryZone',
      entityId: zoneId,
      before,
      after,
    });
    return after;
  });
}

export async function listAreas(
  principal: Principal,
  zoneId: string,
): Promise<readonly repo.AreaRecord[]> {
  const zone = await repo.findZone(zoneId);
  if (zone === null) throw new NotFoundError('Delivery zone not found', { zoneId });
  assertAuthorized(principal, 'delivery-area:read', {
    type: 'DeliveryArea',
    storeId: zone.storeId,
  });
  return repo.listAreas(zoneId);
}

export async function createArea(
  principal: Principal,
  input: {
    zoneId: string;
    name: string;
    pincode?: string | null;
    matchHints?: readonly string[];
  },
): Promise<repo.AreaRecord> {
  const zone = await repo.findZone(input.zoneId);
  if (zone === null) throw new NotFoundError('Delivery zone not found', { zoneId: input.zoneId });
  assertAuthorized(principal, 'delivery-area:write', {
    type: 'DeliveryArea',
    storeId: zone.storeId,
  });

  const name = assertRequiredName(input.name, 'Area name');
  const pincode = assertOptionalPincode(input.pincode);

  return withTransaction(async (tx) => {
    const area = await repo
      .insertArea(tx, { zoneId: input.zoneId, name, pincode, matchHints: input.matchHints ?? [] })
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictError('That zone already has an area with this name', { name });
        }
        throw error;
      });

    await writeAuditLog(tx, {
      principal,
      action: 'create',
      entityType: 'DeliveryArea',
      entityId: area.id,
      after: area,
    });
    return area;
  });
}

export async function updateArea(
  principal: Principal,
  areaId: string,
  input: {
    name?: string;
    pincode?: string | null;
    matchHints?: readonly string[];
    isActive?: boolean;
  },
): Promise<repo.AreaRecord> {
  const found = await repo.findAreaWithStore(areaId);
  if (found === null) throw new NotFoundError('Delivery area not found', { areaId });
  assertAuthorized(principal, 'delivery-area:write', {
    type: 'DeliveryArea',
    id: areaId,
    storeId: found.storeId,
  });

  return withTransaction(async (tx) => {
    const after = await repo.updateAreaRow(tx, areaId, {
      ...(input.name !== undefined ? { name: assertRequiredName(input.name, 'Area name') } : {}),
      ...(input.pincode !== undefined ? { pincode: assertOptionalPincode(input.pincode) } : {}),
      ...(input.matchHints !== undefined ? { matchHints: input.matchHints } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    });
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'DeliveryArea',
      entityId: areaId,
      before: found.area,
      after,
    });
    return after;
  });
}

// ---------------------------------------------------------------------------
// Serviceability
// ---------------------------------------------------------------------------

/**
 * Which store serves an address (§15). The stable interface a future geo rule
 * slots behind without touching a single caller.
 *
 * Phase 2 has no storefront: only the admin "test serviceability" box calls it.
 */
export async function resolveServiceability(
  input: ServiceabilityInput,
): Promise<ServiceabilityResult> {
  return resolveServiceabilityFrom(input, await repo.loadAreaCandidates());
}

/** Record an out-of-zone attempt as a demand signal (§15). */
export async function captureServiceabilityRequest(input: ServiceabilityInput): Promise<void> {
  const raw = [input.areaId, input.locality, input.pincode].filter(Boolean).join(' ').trim();
  if (raw === '') throw new ValidationError('Nothing to record', {});
  await repo.insertServiceabilityRequest(raw, input.pincode ?? null);
}

/** The store a scoped principal acts in; `null` when it is unscoped. */
function scopeOf(principal: Principal): string | null {
  return principal.kind === 'user' ? principal.storeId : null;
}
