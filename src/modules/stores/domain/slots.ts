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

  // Compare against the instant **truncated to the second**. `formatToParts`
  // has no millisecond field, so `asIfUtc` is always at .000; subtracting the
  // untruncated instant would fold the caller's milliseconds into the offset,
  // and every slot derived from it would inherit them. That made a slot start
  // depend on the sub-second timing of whoever asked, so the window the picker
  // offered and the window checkout validated were never equal.
  return asIfUtc - (instant.getTime() - instant.getMilliseconds());
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

/**
 * Opening hours as minutes after local midnight: `open ≤ start` and
 * `start + slotLength ≤ close` for every window offered. Whole minutes, inside
 * one day, and wide enough to hold at least one window — a store whose hours
 * fit no slot would offer nothing every day and never say why.
 */
export function assertOpeningHours(
  openMinuteOfDay: number,
  closeMinuteOfDay: number,
  slotLengthMinutes: number,
): void {
  const whole = Number.isInteger(openMinuteOfDay) && Number.isInteger(closeMinuteOfDay);
  if (
    !whole ||
    openMinuteOfDay < 0 ||
    closeMinuteOfDay > MINUTES_PER_DAY ||
    openMinuteOfDay >= closeMinuteOfDay
  ) {
    throw new ValidationError(
      'Opening hours must be whole minutes after midnight, opening before closing, within one day',
      { openMinuteOfDay, closeMinuteOfDay },
    );
  }
  if (closeMinuteOfDay - openMinuteOfDay < slotLengthMinutes) {
    throw new ValidationError(
      'Opening hours must be long enough for at least one delivery window',
      {
        openMinuteOfDay,
        closeMinuteOfDay,
        slotLengthMinutes,
      },
    );
  }
}

export interface SlotGridInput {
  readonly from: Date;
  readonly slotLengthMinutes: number;
  readonly timeZone: string;
  /** Opening hours, minutes after local midnight (10:00 = 600). */
  readonly openMinuteOfDay: number;
  /** Closing time, minutes after local midnight (20:00 = 1200). */
  readonly closeMinuteOfDay: number;
  readonly horizonDays?: number;
  readonly leadMinutes?: number;
}

/** Minutes past midnight on the store's wall clock at `instant`. */
function wallClockMinute(instant: number, timeZone: string): number {
  const local = instant + zoneOffsetMs(new Date(instant), timeZone);
  return (((local % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS;
}

/** The store's calendar date at `instant`, as `YYYY-MM-DD`. */
function localDate(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

/**
 * Does the window `[start, end)` sit inside the hours **on the wall clock**?
 *
 * Both ends are read off the clock at their own instant. Not `start + length`:
 * across a spring-forward the window is an hour later on the wall when it ends
 * than arithmetic on its start says — a 60-minute window at 00:00 ends at
 * what the clock calls 02:00 — and the door may well have shut by then (OSCAR
 * M2 on PR #57). And not minute-of-day alone: a window long enough to reach
 * the next calendar **date** reads as a small minute number there — a
 * whole-day window at a shift day's midnight ends at 01:00 the day after —
 * so the end must land on the start's own date, or be exactly the midnight
 * that closes it (OSCAR round 3). Within the date, a clock end not after the
 * clock start (a fall-back's repeated hour) does not fit either.
 */
function insideHours(
  start: number,
  end: number,
  timeZone: string,
  openMinuteOfDay: number,
  closeMinuteOfDay: number,
): boolean {
  const opensAt = wallClockMinute(start, timeZone);
  if (opensAt < openMinuteOfDay) return false;
  const date = localDate(start, timeZone);
  const rawEnd = wallClockMinute(end, timeZone);
  if (rawEnd === 0) {
    // Exactly midnight: the one that closes this date, not a later one.
    return localDate(end - MINUTE_MS, timeZone) === date && MINUTES_PER_DAY <= closeMinuteOfDay;
  }
  return localDate(end, timeZone) === date && rawEnd > opensAt && rawEnd <= closeMinuteOfDay;
}

/**
 * Every slot start a shopper may choose, in order.
 *
 * This is the **single definition** of "is that a real window": both the picker
 * and `placeOrder` ask this rather than each doing their own arithmetic, so a
 * slot that can be offered is exactly a slot that can be booked.
 */
export function slotGrid(input: SlotGridInput): Date[] {
  const { from, slotLengthMinutes, timeZone, openMinuteOfDay, closeMinuteOfDay } = input;
  assertSlotLength(slotLengthMinutes);
  assertOpeningHours(openMinuteOfDay, closeMinuteOfDay, slotLengthMinutes);
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

    // The opening hours are a **filter over that anchored grid**, not a second
    // anchor: a window is offered when it is one the full day would offer *and*
    // it sits inside the hours on the store's wall clock. Judged on the wall
    // clock (`zoneOffsetMs` at the window itself) rather than as minutes since
    // the day's midnight, so that on a DST-shift day "10:00" is still 10:00 on
    // the wall — the day is an hour shorter or longer, the door opens when the
    // clock on it says so.
    for (let cursor = day; cursor < nextDay && cursor <= latest; cursor += step) {
      if (cursor < earliest) continue;
      if (!insideHours(cursor, cursor + step, timeZone, openMinuteOfDay, closeMinuteOfDay))
        continue;
      slots.push(new Date(cursor));
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
