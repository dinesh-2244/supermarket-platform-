/**
 * Pure domain logic for `stores` — no I/O, no Prisma, no framework types.
 */
import { ValidationError } from '../../platform/index';

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'stores',
  owns: 'Store, StoreSettings, DeliveryZone, DeliveryArea, resolveServiceability',
  dependsOn: ['platform'],
  emits: [],
};

// ---------------------------------------------------------------------------
// Serviceability (§15, ADR-0004)
// ---------------------------------------------------------------------------

/**
 * How a customer told us where they are.
 *
 * `areaId` is the precise answer — they picked a locality from the list we
 * curate. `locality` + `pincode` is the fuzzy one, typed or pasted. Both are
 * accepted because a storefront will eventually offer both, and the interface
 * has to be stable before either exists (§15).
 */
export interface ServiceabilityInput {
  readonly areaId?: string;
  readonly locality?: string;
  readonly pincode?: string;
}

export interface ServiceableResult {
  readonly servable: true;
  readonly storeId: string;
  readonly zoneId: string;
  readonly areaId: string;
  readonly deliveryFeePaise: number;
  readonly minOrderPaise: number;
  readonly slotLengthMinutes: number;
  readonly slotCapacity: number;
}

export interface UnserviceableResult {
  readonly servable: false;
  /** Why, in terms a storefront can turn into a message. */
  readonly reason: 'no-input' | 'unknown-area' | 'out-of-zone' | 'store-closed';
}

export type ServiceabilityResult = ServiceableResult | UnserviceableResult;

/** A curated delivery area, flattened with the store and zone it belongs to. */
export interface AreaCandidate {
  readonly areaId: string;
  readonly areaName: string;
  readonly pincode: string | null;
  readonly matchHints: readonly string[];
  readonly zoneId: string;
  readonly storeId: string;
  readonly storeIsActive: boolean;
  readonly isAcceptingOrders: boolean;
  readonly deliveryFeePaise: number;
  readonly minOrderPaise: number;
  readonly slotLengthMinutes: number;
  readonly slotCapacity: number;
}

/** Lower-case, collapse whitespace, drop punctuation people vary on. */
export function normalizeLocality(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePincode(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * Decide which store serves an address.
 *
 * **Pincode is a hint, never the key** (R8 / ADR-0004). Two areas under
 * different stores are allowed to share one pincode, so a pincode alone can be
 * ambiguous — matching on it as though it were unique is precisely the bug this
 * rule exists to prevent. The order is therefore:
 *
 * 1. an explicit `areaId` — the customer picked from our own list;
 * 2. a locality name (exact, then a match hint, then a prefix), narrowed by
 *    pincode when one was given;
 * 3. pincode alone — accepted **only** when it identifies exactly one area.
 *    Two candidates means we genuinely do not know, and guessing would silently
 *    route half the orders to the wrong store.
 *
 * Pure: the caller loads the candidates, so this is unit-testable with no
 * database and a future geo rule needs no change at the call site.
 */
export function resolveServiceabilityFrom(
  input: ServiceabilityInput,
  candidates: readonly AreaCandidate[],
): ServiceabilityResult {
  const open = candidates.filter((c) => c.storeIsActive);

  if (input.areaId !== undefined && input.areaId !== '') {
    const exact = open.find((c) => c.areaId === input.areaId);
    if (exact === undefined) return { servable: false, reason: 'unknown-area' };
    return finalize(exact);
  }

  const locality = input.locality === undefined ? '' : normalizeLocality(input.locality);
  const pincode = input.pincode === undefined ? '' : normalizePincode(input.pincode);

  if (locality === '' && pincode === '') return { servable: false, reason: 'no-input' };

  if (locality !== '') {
    const byPincode = pincode === '' ? open : open.filter((c) => c.pincode === pincode);
    // Fall back to the unfiltered set: a right locality with a mistyped pincode
    // should still resolve, since the pincode was only ever a hint.
    const pool = byPincode.length > 0 ? byPincode : open;

    const exact = pool.filter((c) => normalizeLocality(c.areaName) === locality);
    if (exact.length === 1) return finalize(exact[0]!);

    const hinted = pool.filter((c) => c.matchHints.some((h) => normalizeLocality(h) === locality));
    if (hinted.length === 1) return finalize(hinted[0]!);

    const prefixed = pool.filter(
      (c) =>
        normalizeLocality(c.areaName).startsWith(locality) ||
        locality.startsWith(normalizeLocality(c.areaName)),
    );
    if (prefixed.length === 1) return finalize(prefixed[0]!);

    // Several areas match the name. If a pincode narrowed it to one store, that
    // is still an answer; otherwise it is genuinely ambiguous.
    const stores = new Set([...exact, ...hinted, ...prefixed].map((c) => c.storeId));
    if (stores.size === 1) {
      const first = [...exact, ...hinted, ...prefixed][0];
      if (first !== undefined) return finalize(first);
    }
    if (pincode === '') return { servable: false, reason: 'out-of-zone' };
  }

  if (pincode !== '') {
    const matches = open.filter((c) => c.pincode === pincode);
    // Exactly one, or several that all belong to the same store — either way we
    // know where to send it. More than one store means we do not.
    if (matches.length === 1) return finalize(matches[0]!);
    if (matches.length > 1) {
      const stores = new Set(matches.map((c) => c.storeId));
      if (stores.size === 1) return finalize(matches[0]!);
    }
  }

  return { servable: false, reason: 'out-of-zone' };
}

function finalize(area: AreaCandidate): ServiceabilityResult {
  if (!area.isAcceptingOrders) return { servable: false, reason: 'store-closed' };
  return {
    servable: true,
    storeId: area.storeId,
    zoneId: area.zoneId,
    areaId: area.areaId,
    deliveryFeePaise: area.deliveryFeePaise,
    minOrderPaise: area.minOrderPaise,
    slotLengthMinutes: area.slotLengthMinutes,
    slotCapacity: area.slotCapacity,
  };
}

// ---------------------------------------------------------------------------
// Settings validation
// ---------------------------------------------------------------------------

/** The `StoreSettings` fields a store manager may edit. `posMode` is not one. */
export interface EditableSettings {
  readonly deliveryFeePaise?: number;
  readonly minOrderPaise?: number;
  readonly slotLengthMinutes?: number;
  readonly slotCapacity?: number;
  readonly priceVariancePercentBp?: number;
  readonly priceVarianceAbsCapPaise?: number;
  readonly isAcceptingOrders?: boolean;
  readonly substitutionPolicy?: 'NONE' | 'ASK_CUSTOMER' | 'STAFF_DISCRETION';
  readonly lowStockThreshold?: number;
}

/**
 * The field names a settings update may carry, as a **runtime** value.
 *
 * `EditableSettings` restricts this at compile time only, which is not a
 * boundary: `Object.entries()` of a structurally wider object — or any
 * JavaScript caller — happily carried `posMode` straight through to Prisma,
 * bypassing the super-admin-only grant on `updatePosMode`. The update is now
 * built from this list, so a field that is not on it cannot reach the database
 * however the object was constructed.
 */
export const EDITABLE_SETTINGS_FIELDS = [
  'deliveryFeePaise',
  'minOrderPaise',
  'slotLengthMinutes',
  'slotCapacity',
  'priceVariancePercentBp',
  'priceVarianceAbsCapPaise',
  'isAcceptingOrders',
  'substitutionPolicy',
  'lowStockThreshold',
] as const;

export type EditableSettingsField = (typeof EDITABLE_SETTINGS_FIELDS)[number];

/**
 * Keep only the allowed fields, type-checking each one, and refuse anything else
 * loudly rather than dropping it silently — a caller that thought it was setting
 * `posMode` should be told it was not.
 */
export function pickEditableSettings(input: Readonly<Record<string, unknown>>): EditableSettings {
  const allowed = new Set<string>(EDITABLE_SETTINGS_FIELDS);
  const rejected = Object.keys(input).filter((key) => !allowed.has(key));
  if (rejected.length > 0) {
    throw new ValidationError(`These settings cannot be changed here: ${rejected.join(', ')}`, {
      rejected,
    });
  }

  const out: {
    -readonly [K in keyof EditableSettings]: EditableSettings[K];
  } = {};

  for (const field of EDITABLE_SETTINGS_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;

    if (field === 'isAcceptingOrders') {
      if (typeof value !== 'boolean') {
        throw new ValidationError('isAcceptingOrders must be true or false', { value });
      }
      out.isAcceptingOrders = value;
    } else if (field === 'substitutionPolicy') {
      if (value !== 'NONE' && value !== 'ASK_CUSTOMER' && value !== 'STAFF_DISCRETION') {
        throw new ValidationError('That substitution policy is not one of the allowed values', {
          value,
        });
      }
      out.substitutionPolicy = value;
    } else {
      if (typeof value !== 'number') {
        throw new ValidationError(`${field} must be a number`, { field, value });
      }
      out[field] = value;
    }
  }
  return out;
}

function assertNonNegativeInt(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a whole number of zero or more`, { field, value });
  }
}

function assertPositiveInt(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ValidationError(`${field} must be a whole number greater than zero`, {
      field,
      value,
    });
  }
}

/** Money is integer paise end to end — a rupee float would round its way in. */
export function assertEditableSettings(input: EditableSettings): void {
  if (input.deliveryFeePaise !== undefined)
    assertNonNegativeInt(input.deliveryFeePaise, 'deliveryFeePaise');
  if (input.minOrderPaise !== undefined) assertNonNegativeInt(input.minOrderPaise, 'minOrderPaise');
  if (input.priceVarianceAbsCapPaise !== undefined)
    assertNonNegativeInt(input.priceVarianceAbsCapPaise, 'priceVarianceAbsCapPaise');
  if (input.lowStockThreshold !== undefined)
    assertNonNegativeInt(input.lowStockThreshold, 'lowStockThreshold');
  if (input.slotLengthMinutes !== undefined)
    assertPositiveInt(input.slotLengthMinutes, 'slotLengthMinutes');
  if (input.slotCapacity !== undefined) assertPositiveInt(input.slotCapacity, 'slotCapacity');

  if (input.priceVariancePercentBp !== undefined) {
    assertNonNegativeInt(input.priceVariancePercentBp, 'priceVariancePercentBp');
    if (input.priceVariancePercentBp > 10_000) {
      throw new ValidationError('priceVariancePercentBp cannot exceed 100% (10000bp)', {
        value: input.priceVariancePercentBp,
      });
    }
  }
}

export function assertStoreCode(code: string): string {
  const trimmed = code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{1,15}$/.test(trimmed)) {
    throw new ValidationError('Store code must be 2–16 characters of A–Z, 0–9 or "-"', { code });
  }
  return trimmed;
}

export function assertRequiredName(name: string, field = 'Name'): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new ValidationError(`${field} is required`, {});
  return trimmed;
}

/** Optional and non-unique by design — two areas may share one (ADR-0004). */
export function assertOptionalPincode(pincode: string | null | undefined): string | null {
  if (pincode === null || pincode === undefined || pincode.trim() === '') return null;
  const digits = normalizePincode(pincode);
  if (!/^\d{6}$/.test(digits)) {
    throw new ValidationError('An Indian pincode is six digits', { pincode });
  }
  return digits;
}
