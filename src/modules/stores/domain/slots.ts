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

const MINUTES_PER_DAY = 24 * 60;

/**
 * A slot length must divide the day.
 *
 * Not a stylistic rule. A length that does not divide 1,440 cannot produce a
 * coherent daily grid at all, and both ways of building one are wrong in a
 * different direction (OSCAR R3):
 *
 * - walk a single cursor from the first day's midnight and the grid **drifts** —
 *   50-minute windows shift 20 minutes every day, so a window offered on Monday
 *   evening has vanished by Tuesday morning and a shopper's booked slot is no
 *   longer one the picker believes in;
 * - anchor each day to its own midnight and the last window of a day
 *   **overlaps** the first of the next — 23:20-00:10 against 00:00-00:50 — so
 *   the same ten minutes are counted for capacity under two different
 *   `<storeId>:<slotStart>` keys.
 *
 * The settings validator accepted 50 because it only asked for a positive
 * integer. Rejecting it here *and* there is what "consistently at the
 * configuration boundary" means: a store cannot be saved into the broken state,
 * and a store already in it fails loudly rather than quietly mis-serving.
 */
export function assertSlotLength(slotLengthMinutes: number): void {
  if (!Number.isInteger(slotLengthMinutes) || slotLengthMinutes <= 0) {
    throw new ValidationError('A store must have a positive slot length', { slotLengthMinutes });
  }
  if (slotLengthMinutes > MINUTES_PER_DAY || MINUTES_PER_DAY % slotLengthMinutes !== 0) {
    throw new ValidationError(
      'A delivery slot must divide the day evenly, so every day offers the same windows',
      { slotLengthMinutes, allowedExamples: [15, 20, 30, 45, 60, 90, 120] },
    );
  }
}

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
  assertSlotLength(slotLengthMinutes);
  if (Number.isNaN(from.getTime())) {
    throw new ValidationError('Slots need a valid instant to start from', {});
  }

  const horizonDays = input.horizonDays ?? SLOT_HORIZON_DAYS;
  const leadMinutes = input.leadMinutes ?? SLOT_LEAD_MINUTES;

  const earliest = from.getTime() + leadMinutes * MINUTE_MS;
  const latest = from.getTime() + horizonDays * DAY_MS;
  const step = slotLengthMinutes * MINUTE_MS;

  const slots: Date[] = [];

  // **Each day is generated from its own local midnight**, not by walking a
  // single cursor across the whole horizon from today's.
  //
  // The difference only shows when the slot length does not divide a day. With
  // 50-minute windows, a cursor started at Monday midnight lands on Tuesday at
  // 00:10, 01:00, 01:50 … — a grid that shifts by 20 minutes every day. Ask on
  // Monday evening and Tuesday's 10:10 window is offered; ask again after
  // midnight, when Tuesday is now the anchor day, and 10:10 is gone while 10:00
  // has appeared. A window a shopper was shown, or had already booked, could
  // vanish from the picker, and two overlapping windows could count capacity
  // under different keys (OSCAR R3).
  //
  // Anchoring per day makes a window's identity a function of its own date and
  // the store's settings, and of nothing else — which is what the capacity key
  // `<storeId>:<slotStart>` has to be able to assume.
  const firstDay = localDayStart(from, timeZone).getTime();
  for (let day = firstDay; day <= latest;) {
    const nextDay = localDayStart(new Date(day + DAY_MS + 2 * 60 * MINUTE_MS), timeZone).getTime();

    for (let cursor = day; cursor < nextDay && cursor <= latest; cursor += step) {
      if (cursor >= earliest) slots.push(new Date(cursor));
    }

    // A DST-shortened day could otherwise fail to advance.
    day = nextDay > day ? nextDay : day + DAY_MS;
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
