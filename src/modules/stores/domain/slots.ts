/**
 * Delivery-slot arithmetic (phase-4-plan D3). Pure: given a store's settings, a
 * timezone and an instant, this decides which windows exist. Whether a window
 * still has room is a fact about other orders and lives in the service.
 *
 * Slots are anchored to **midnight in the store's own timezone**, not to UTC and
 * not to "now". Two reasons, and both are load-bearing:
 *
 * - anchoring to now would give every shopper a different grid, so the capacity
 *   count in `placeOrder` would be counting a different window for each of them;
 * - anchoring to UTC would put an Asia/Kolkata store's hourly windows at half
 *   past the hour, because IST is UTC+05:30.
 */
import { ValidationError } from '../../platform/index';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

export interface Slot {
  readonly start: Date;
  readonly end: Date;
  readonly capacityRemaining: number;
}

/**
 * How far `timeZone` is from UTC at this instant, in milliseconds.
 *
 * Derived from `Intl` rather than a table: the platform already ships the tz
 * database, and a hand-rolled offset is a DST bug waiting for the first store
 * outside India.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) parts[part.type] = part.value;

  const asIfUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    // `hour12: false` renders midnight as 24 in some ICU versions.
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which the store's local day containing `instant` began.
 *
 * Resolved twice because the offset itself depends on the answer: on a DST
 * boundary the offset at noon is not the offset at midnight, and the first pass
 * uses the wrong one. India never shifts, so this is insurance rather than a
 * fix — but it is the kind of insurance that costs two lines and is impossible
 * to add later without a bug report first.
 */
export function localDayStart(instant: Date, timeZone: string): Date {
  const firstGuess = new Date(
    Math.floor((instant.getTime() + zoneOffsetMs(instant, timeZone)) / DAY_MS) * DAY_MS -
      zoneOffsetMs(instant, timeZone),
  );
  const corrected = new Date(
    Math.floor((instant.getTime() + zoneOffsetMs(firstGuess, timeZone)) / DAY_MS) * DAY_MS -
      zoneOffsetMs(firstGuess, timeZone),
  );
  return corrected;
}

/**
 * How soon a shopper may book. Two hours is enough for a store to pick and pack
 * an order without a rush; it is a platform constant for now, and becomes a
 * `StoreSettings` column the day one store disagrees with another (ADR-0011).
 */
export const SLOT_LEAD_MINUTES = 120;

/** How far ahead a shopper may book. */
export const SLOT_HORIZON_DAYS = 3;

export interface SlotGridInput {
  readonly from: Date;
  readonly slotLengthMinutes: number;
  readonly timeZone: string;
  readonly horizonDays?: number;
  readonly leadMinutes?: number;
}

/**
 * Every slot start a shopper may choose, in order.
 *
 * This is the **single definition** of "is that a real window": both the picker
 * and `placeOrder` ask this rather than each doing their own arithmetic, so a
 * slot that can be offered is exactly a slot that can be booked.
 */
export function slotGrid(input: SlotGridInput): Date[] {
  const { from, slotLengthMinutes, timeZone } = input;
  if (!Number.isInteger(slotLengthMinutes) || slotLengthMinutes <= 0) {
    throw new ValidationError('A store must have a positive slot length', { slotLengthMinutes });
  }
  if (Number.isNaN(from.getTime())) {
    throw new ValidationError('Slots need a valid instant to start from', {});
  }

  const horizonDays = input.horizonDays ?? SLOT_HORIZON_DAYS;
  const leadMinutes = input.leadMinutes ?? SLOT_LEAD_MINUTES;

  const earliest = from.getTime() + leadMinutes * MINUTE_MS;
  const latest = from.getTime() + horizonDays * DAY_MS;
  const step = slotLengthMinutes * MINUTE_MS;

  const slots: Date[] = [];
  // Start from the store's local midnight so the grid is the same for everyone,
  // then walk forward. A day is never more than 24 h + one hour of DST slack.
  for (let cursor = localDayStart(from, timeZone).getTime(); cursor <= latest; cursor += step) {
    if (cursor >= earliest) slots.push(new Date(cursor));
  }
  return slots;
}

/** Is this exactly one of the slots the grid offers? */
export function isBookableSlot(start: Date, input: SlotGridInput): boolean {
  const wanted = start.getTime();
  if (Number.isNaN(wanted)) return false;
  return slotGrid(input).some((slot) => slot.getTime() === wanted);
}

/** The end of the window a slot start opens. */
export function slotEndOf(start: Date, slotLengthMinutes: number): Date {
  return new Date(start.getTime() + slotLengthMinutes * MINUTE_MS);
}
