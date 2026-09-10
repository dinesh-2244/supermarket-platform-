/**
 * Use-cases for `stores`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 */
import {
  assertAuthorized,
  AuthzError,
  ConflictError,
  NotFoundError,
  Prisma,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type DbExecutor,
  type Principal,
} from '../platform/index';
import {
  assertEditableSettings,
  assertOptionalPincode,
  assertRequiredName,
  assertStoreCode,
  descriptor,
  pickEditableSettings,
  resolveServiceabilityFrom,
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
      storeId: store.id,
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
      storeId,
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
  // A shopper reads settings through `getStorefrontSettings`. This shape carries
  // the POS mode, the substitution policy and the price-variance thresholds —
  // operational configuration that has no business on a customer-facing page,
  // and which a narrower return type is the only reliable way to keep off it.
  refuseCustomer(principal, 'StoreSettings');
  const settings = await repo.findSettings(storeId);
  if (settings === null) throw new NotFoundError('Store settings not found', { storeId });
  return settings;
}

/** The only store settings a storefront page may see: what it has to display. */
export interface StorefrontSettings {
  readonly storeId: string;
  readonly deliveryFeePaise: number;
  readonly minOrderPaise: number;
  readonly isAcceptingOrders: boolean;
  readonly slotLengthMinutes: number;
  readonly slotCapacity: number;
}

/**
 * Store settings for the storefront — a deliberately narrow projection.
 *
 * Everything here is a fact the shopper is entitled to before they order: what
 * delivery costs, what the minimum is, whether the shop is taking orders, and
 * (for Phase 4) how slots are shaped. `posMode`, `substitutionPolicy` and the
 * price-variance thresholds are absent by construction, not by filtering at the
 * call site.
 */
export async function getStorefrontSettings(
  principal: Principal,
  storeId: string,
): Promise<StorefrontSettings> {
  assertAuthorized(principal, 'store-settings:read', { type: 'StoreSettings', storeId });
  const settings = await repo.findSettings(storeId);
  if (settings === null) throw new NotFoundError('Store settings not found', { storeId });
  return {
    storeId: settings.storeId,
    deliveryFeePaise: settings.deliveryFeePaise,
    minOrderPaise: settings.minOrderPaise,
    isAcceptingOrders: settings.isAcceptingOrders,
    slotLengthMinutes: settings.slotLengthMinutes,
    slotCapacity: settings.slotCapacity,
  };
}

/**
 * Refuse a shopper a shape built for the back office.
 *
 * The grant table says a customer may *read* their store's settings; this says
 * which projection they get. Both are needed: without the grant they could read
 * nothing, and without this they would read everything.
 */
function refuseCustomer(principal: Principal, type: string): void {
  if (principal.kind === 'customer') {
    throw new AuthzError('You do not have permission to perform this action', {
      resourceType: type,
      reason: 'this shape is for the back office; a storefront has a narrower one',
    });
  }
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
  input: Readonly<Record<string, unknown>>,
): Promise<repo.SettingsRecord> {
  assertAuthorized(principal, 'store-settings:update', { type: 'StoreSettings', storeId });

  // Allowlist at *runtime*, not just in the type. `EditableSettings` deliberately
  // omits `posMode`, but a TypeScript interface is not a boundary — forwarding
  // every key of the input let a manager set `posMode: 'ADAPTER'` and walk past
  // the super-admin grant on `updatePosMode` below.
  const data = pickEditableSettings(input);
  assertEditableSettings(data);

  const before = await repo.findSettings(storeId);
  if (before === null) throw new NotFoundError('Store settings not found', { storeId });

  if (Object.keys(data).length === 0) return before;

  return withTransaction(async (tx) => {
    const after = await repo.updateSettingsRow(tx, storeId, { ...data });
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'StoreSettings',
      entityId: after.id,
      storeId,
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
      storeId,
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
      storeId: input.storeId,
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
      storeId: before.storeId,
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
      storeId: zone.storeId,
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
      storeId: found.storeId,
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

/**
 * The curated delivery areas a storefront visitor may choose between.
 *
 * Principal-less on purpose, and the only stores/areas read that is: the
 * locality picker is the very first thing an anonymous visitor sees, before any
 * store context exists, so there is nothing yet to scope a principal to. It
 * returns exactly the routing data `resolveServiceability` already consumes —
 * area, zone, store and whether that store is open — and nothing about the
 * business behind it. Ordering is stable so the picker does not reshuffle.
 */
export async function listServiceableAreas(): Promise<readonly StorefrontArea[]> {
  const candidates = await repo.loadAreaCandidates();
  return candidates
    .filter((candidate) => candidate.storeIsActive)
    .map((candidate) => ({
      areaId: candidate.areaId,
      areaName: candidate.areaName,
      pincode: candidate.pincode,
      storeId: candidate.storeId,
      isAcceptingOrders: candidate.isAcceptingOrders,
    }))
    .sort((a, b) => a.areaName.localeCompare(b.areaName));
}

/**
 * Is this an area we could deliver an order to?
 *
 * The question an address book has to ask before it saves an area — an address
 * pointing somewhere nobody delivers would fail at checkout, far too late for
 * the shopper to fix it. Answered from the same candidate set the picker and
 * `resolveServiceability` use, so "we deliver here" means one thing across the
 * whole application: an active area, in an active zone, of an active store.
 *
 * Deliberately **not** `resolveServiceability`, which additionally refuses a
 * store that has temporarily stopped accepting orders. That is a fact about
 * tonight, not about the address: a shopper may save their home address while
 * their shop is closed, and the routing rules apply again when they order.
 *
 * Principal-less for the same reason `listServiceableAreas` is: this is asked
 * before any store context exists, and the answer is one bit about the shop's
 * own coverage, not about anybody's data.
 */
export async function isDeliverableArea(areaId: string): Promise<boolean> {
  if (areaId === '') return false;
  return (await listServiceableAreas()).some((area) => area.areaId === areaId);
}

/** One row of the locality picker. Deliberately narrower than `AreaCandidate`. */
export interface StorefrontArea {
  readonly areaId: string;
  readonly areaName: string;
  readonly pincode: string | null;
  readonly storeId: string;
  readonly isAcceptingOrders: boolean;
}

/**
 * The store's low-stock threshold (§22).
 *
 * `inventory` needs this to decide whether a movement crossed the line and
 * should emit `stock.low`. It used to read `StoreSettings` directly — a §4
 * violation pinned as a known exception in `model-ownership.test.ts` and tracked
 * as `p3-followup-model-ownership`.
 *
 * Principal-less, deliberately, and for a narrower reason than
 * {@link listServiceableAreas}. The caller is `applyMovement`, whose principal
 * is whoever *caused* the movement — a staff member adjusting stock, the seed
 * writing opening balances, or a shopper whose order took a unit off the shelf.
 * `getSettings` refuses a customer principal on purpose, because its shape
 * carries POS mode and variance thresholds; routing this through it would deny
 * a legitimate movement over a number that is neither confidential nor ever
 * rendered to a shopper. So this returns the one integer and nothing else.
 *
 * `0` when the store has no settings row: a threshold nothing can fall below,
 * which is the safe reading of "not configured".
 *
 * Takes the caller's `DbExecutor` for a reason that is easy to miss.
 * `applyMovement` runs inside an interactive transaction, and a query issued on
 * the singleton client from in there takes a *second* connection out of the
 * pool while the first is still held. With a small pool — CI runs
 * `connection_limit=5` — enough concurrent movements would then wait on a
 * connection none of them can release. Reading on the caller's handle keeps it
 * to the one connection they already hold.
 */
export async function lowStockThresholdFor(storeId: string, db?: DbExecutor): Promise<number> {
  const settings = await repo.findSettings(storeId, db);
  return settings?.lowStockThreshold ?? 0;
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
