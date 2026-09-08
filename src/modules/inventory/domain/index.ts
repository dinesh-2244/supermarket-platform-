/**
 * Pure domain logic for `inventory` — no I/O, no Prisma, no framework types.
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
  name: 'inventory',
  owns: 'InventoryItem (websiteStock), StockLedger, CSV import, reconcile, POS-feed boundary',
  dependsOn: ['platform', 'catalog', 'stores'],
  emits: ['stock.low', 'stock.changed'],
};

/**
 * Every website-stock movement carries one of these (§7, R3/R11/R12).
 *
 * Phase 2 only ever *triggers* `MANUAL_ADJUST`, `RECONCILE` and `CSV_IMPORT`.
 * The rest are accepted by the write API now so that Phase 4/5 — order
 * placement, short-pick restores, admin corrections, a future POS sync — add
 * callers rather than reopening the one function that touches stock.
 */
export type StockReason =
  | 'MANUAL_ADJUST'
  | 'CSV_IMPORT'
  | 'RECONCILE'
  | 'ORDER_PLACED'
  | 'PICK_SHORT_RESTORE'
  | 'ADMIN_CORRECTION'
  | 'POS_SYNC';

export const STOCK_REASONS: readonly StockReason[] = [
  'MANUAL_ADJUST',
  'CSV_IMPORT',
  'RECONCILE',
  'ORDER_PLACED',
  'PICK_SHORT_RESTORE',
  'ADMIN_CORRECTION',
  'POS_SYNC',
];

/** The reasons a Phase 2 admin action is allowed to use. */
export const ADMIN_REASONS: readonly StockReason[] = ['MANUAL_ADJUST', 'RECONCILE', 'CSV_IMPORT'];

/**
 * Work out the new balance, or say why it cannot be reached.
 *
 * Stock is never allowed below zero: `websiteStock` is "available to sell"
 * (R3/R5), and a negative one would be offered to a customer as a positive
 * number by any code that clamps it, or silently oversell if it does not.
 * Refusing here — before the row is touched — is what keeps the ledger's
 * `balanceAfter` equal to a balance that actually exists.
 */
export function nextBalance(current: number, delta: number): number {
  if (!Number.isSafeInteger(delta)) {
    throw new ValidationError('A stock movement must be a whole number', { delta });
  }
  if (delta === 0) {
    throw new ValidationError('A stock movement of zero changes nothing', { delta });
  }

  const next = current + delta;
  if (next < 0) {
    throw new ValidationError('That would take stock below zero', {
      current,
      delta,
      wouldBe: next,
    });
  }
  if (!Number.isSafeInteger(next)) {
    throw new ValidationError('The resulting stock is out of range', { current, delta });
  }
  return next;
}

/** The signed movement that takes `current` to a counted quantity. */
export function reconcileDelta(current: number, counted: number): number {
  if (!Number.isSafeInteger(counted) || counted < 0) {
    throw new ValidationError('A counted quantity is zero or a positive whole number', { counted });
  }
  return counted - current;
}

export function assertQuantity(value: number, field = 'quantity'): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be zero or a positive whole number`, { field, value });
  }
  return value;
}

/**
 * Whether this movement crossed the low-stock threshold *downwards*.
 *
 * Only the crossing fires `stock.low`, not every movement that happens to sit
 * below the line — otherwise every sale of an already-low item raises another
 * alert and the alert stops meaning anything.
 */
export function crossedLowThresholdDownward(
  before: number,
  after: number,
  threshold: number,
): boolean {
  return before > threshold && after <= threshold;
}

export function isLow(balance: number, threshold: number): boolean {
  return balance <= threshold;
}

// ---------------------------------------------------------------------------
// Storefront availability
// ---------------------------------------------------------------------------

/**
 * What a shopper is told about stock.
 *
 * Deliberately a *band*, not a number. Publishing an exact `websiteStock` on a
 * public page hands a competitor a live inventory feed and tells anyone who
 * cares exactly how much they can buy before the shelf empties. What the shopper
 * actually needs to decide is whether to add the item and whether to hurry, and
 * three bands answer both.
 */
export type Availability = 'IN_STOCK' | 'LOW' | 'OUT_OF_STOCK';

/**
 * At or below this many units the storefront says "only N left" and names N.
 *
 * The exact figure is disclosed *only* inside this band, where it is urgency
 * the shopper needs rather than intelligence anyone can harvest. It is a display
 * constant, deliberately separate from `StoreSettings.lowStockThreshold`, which
 * is an operational alert level a store manager tunes for their own restocking —
 * the two answer different questions and must be free to differ.
 */
export const LOW_STOCK_DISPLAY_THRESHOLD = 5;

export function availabilityOf(
  websiteStock: number,
  threshold: number = LOW_STOCK_DISPLAY_THRESHOLD,
): Availability {
  if (websiteStock <= 0) return 'OUT_OF_STOCK';
  return websiteStock <= threshold ? 'LOW' : 'IN_STOCK';
}

/** The count to show, or `null` when the band is all the shopper is told. */
export function displayableRemaining(
  websiteStock: number,
  threshold: number = LOW_STOCK_DISPLAY_THRESHOLD,
): number | null {
  const band = availabilityOf(websiteStock, threshold);
  return band === 'IN_STOCK' ? null : Math.max(0, websiteStock);
}
