import { describe, expect, it } from 'vitest';
import {
  assertOpeningHours,
  assertSlotLength,
  isBookableSlot,
  localDayStart,
  slotEndOf,
  slotGrid,
  SLOT_HORIZON_DAYS,
  SLOT_LEAD_MINUTES,
  zoneOffsetMs,
} from '../domain/slots';

const IST = 'Asia/Kolkata';
const UTC = 'UTC';
const LONDON = 'Europe/London';

describe('zoneOffsetMs', () => {
  it('is +5:30 for India, all year — the country does not shift', () => {
    const winter = zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), IST);
    const summer = zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), IST);

    expect(winter).toBe(5.5 * 60 * 60 * 1000);
    expect(summer).toBe(winter);
  });

  it('is zero for UTC', () => {
    expect(zoneOffsetMs(new Date('2026-03-01T00:00:00Z'), UTC)).toBe(0);
  });

  it('follows a zone that does shift', () => {
    expect(zoneOffsetMs(new Date('2026-01-15T12:00:00Z'), LONDON)).toBe(0);
    expect(zoneOffsetMs(new Date('2026-07-15T12:00:00Z'), LONDON)).toBe(60 * 60 * 1000);
  });
});

describe('zoneOffsetMs — sub-second inputs', () => {
  it('is the same whatever milliseconds the caller happens to carry', () => {
    // Regression: the offset was measured against the untruncated instant while
    // `formatToParts` produced a whole second, so the caller's milliseconds were
    // folded into the offset. Every slot derived from it then inherited them,
    // and the window the picker offered was never *equal* to the window
    // checkout re-derived a moment later — only within a second of it.
    const whole = zoneOffsetMs(new Date('2026-03-01T12:00:00.000Z'), IST);
    for (const ms of [1, 301, 395, 999]) {
      expect(
        zoneOffsetMs(new Date(`2026-03-01T12:00:00.${String(ms).padStart(3, '0')}Z`), IST),
      ).toBe(whole);
    }
  });

  it('produces slot starts on a whole second regardless of when it is asked', () => {
    for (const ms of [0, 1, 301, 999]) {
      const slots = slotGrid({
        from: new Date(`2026-03-01T06:00:00.${String(ms).padStart(3, '0')}Z`),
        slotLengthMinutes: 60,
        timeZone: IST,
        horizonDays: 1,
        openMinuteOfDay: 600,
        closeMinuteOfDay: 1200,
      });
      for (const slot of slots.slice(0, 5)) expect(slot.getMilliseconds()).toBe(0);
    }
  });

  it('offers the identical grid to two callers a few hundred ms apart', () => {
    // The property the checkout flow actually depends on: the picker renders,
    // the shopper submits, and `placeOrder` re-derives the grid. Those two must
    // agree exactly, not approximately.
    const a = slotGrid({
      from: new Date('2026-03-01T06:00:00.100Z'),
      slotLengthMinutes: 60,
      timeZone: IST,
      horizonDays: 1,
      openMinuteOfDay: 600,
      closeMinuteOfDay: 1200,
    });
    const b = slotGrid({
      from: new Date('2026-03-01T06:00:00.900Z'),
      slotLengthMinutes: 60,
      timeZone: IST,
      horizonDays: 1,
      openMinuteOfDay: 600,
      closeMinuteOfDay: 1200,
    });

    expect(b.map((d) => d.toISOString())).toEqual(a.map((d) => d.toISOString()));
  });
});

describe('localDayStart', () => {
  it('is 18:30 UTC the previous day for India', () => {
    // 2026-03-02 00:00 IST is 2026-03-01 18:30 UTC.
    expect(localDayStart(new Date('2026-03-02T09:00:00+05:30'), IST)).toEqual(
      new Date('2026-03-01T18:30:00Z'),
    );
  });

  it('is the same instant for a time already at local midnight', () => {
    expect(localDayStart(new Date('2026-03-01T18:30:00Z'), IST)).toEqual(
      new Date('2026-03-01T18:30:00Z'),
    );
  });

  it('is plain UTC midnight for a UTC store', () => {
    expect(localDayStart(new Date('2026-03-01T13:45:00Z'), UTC)).toEqual(
      new Date('2026-03-01T00:00:00Z'),
    );
  });

  it('lands on local midnight across a DST boundary', () => {
    // Britain springs forward on 2026-03-29. Local midnight that day is still
    // 00:00 UTC; the shift happens at 01:00.
    expect(localDayStart(new Date('2026-03-29T15:00:00Z'), LONDON)).toEqual(
      new Date('2026-03-29T00:00:00Z'),
    );
    // …and the day after, local midnight is 23:00 UTC the night before.
    expect(localDayStart(new Date('2026-03-30T15:00:00Z'), LONDON)).toEqual(
      new Date('2026-03-29T23:00:00Z'),
    );
  });
});

describe('slotGrid', () => {
  const base = {
    slotLengthMinutes: 60,
    timeZone: IST,
    horizonDays: 1,
    leadMinutes: 120,
    openMinuteOfDay: 600,
    closeMinuteOfDay: 1200,
  };

  it('puts hourly windows on the hour in the store’s own timezone', () => {
    const slots = slotGrid({ ...base, from: new Date('2026-03-01T06:00:00Z') });

    // 06:00 UTC is 11:30 IST; with two hours' lead the first bookable window is
    // 14:00 IST = 08:30 UTC. Every window is on the hour *locally*.
    expect(slots[0]).toEqual(new Date('2026-03-01T08:30:00Z'));
    for (const slot of slots) {
      const istMinutes = (slot.getTime() + 5.5 * 3600_000) % 3600_000;
      expect(istMinutes).toBe(0);
    }
  });

  it('honours the lead time — nothing sooner than that is offered', () => {
    const from = new Date('2026-03-01T06:00:00Z');
    const slots = slotGrid({ ...base, from, leadMinutes: 180 });

    expect(slots[0]!.getTime()).toBeGreaterThanOrEqual(from.getTime() + 180 * 60_000);
  });

  it('honours the horizon — nothing beyond it is offered', () => {
    const from = new Date('2026-03-01T06:00:00Z');
    const slots = slotGrid({ ...base, from, horizonDays: 2 });

    expect(slots.at(-1)!.getTime()).toBeLessThanOrEqual(from.getTime() + 2 * 86_400_000);
    // 14:00–19:00 today (6), 10:00–19:00 tomorrow (10), 10:00 and 11:00 on the
    // day the horizon (11:30 IST) cuts off (2).
    expect(slots).toHaveLength(18);
  });

  it('is stable — asking twice a minute apart offers the same windows', () => {
    // The property that makes the capacity count meaningful: two shoppers must
    // be talking about the same window when they book "10:00".
    const first = slotGrid({ ...base, from: new Date('2026-03-01T06:00:00Z') });
    const second = slotGrid({ ...base, from: new Date('2026-03-01T06:01:00Z') });

    expect(second.map((slot) => slot.toISOString())).toEqual(
      first.map((slot) => slot.toISOString()),
    );
  });

  it('follows a store that uses half-hour windows', () => {
    const slots = slotGrid({
      ...base,
      from: new Date('2026-03-01T06:00:00Z'),
      slotLengthMinutes: 30,
    });
    const gaps = slots.slice(1).map((slot, index) => slot.getTime() - slots[index]!.getTime());

    // Half an hour between windows, and the overnight gap from the last
    // window at 19:30 to the next day's 10:00.
    expect(new Set(gaps)).toEqual(new Set([30 * 60_000, 14.5 * 3600_000]));
  });

  it('refuses a nonsense slot length or instant', () => {
    expect(() =>
      slotGrid({ ...base, from: new Date('2026-03-01T06:00:00Z'), slotLengthMinutes: 0 }),
    ).toThrow(/positive slot length/i);
    expect(() =>
      slotGrid({ ...base, from: new Date('2026-03-01T06:00:00Z'), slotLengthMinutes: 45.5 }),
    ).toThrow(/positive slot length/i);
    expect(() => slotGrid({ ...base, from: new Date('nonsense') })).toThrow(/valid instant/i);
  });

  it('ships sensible defaults', () => {
    expect(SLOT_LEAD_MINUTES).toBe(120);
    expect(SLOT_HORIZON_DAYS).toBe(3);
    const slots = slotGrid({
      from: new Date('2026-03-01T06:00:00Z'),
      slotLengthMinutes: 60,
      timeZone: IST,
      openMinuteOfDay: 600,
      closeMinuteOfDay: 1200,
    });
    // 6 today, 10, 10, then 10:00 and 11:00 on the fourth day.
    expect(slots).toHaveLength(28);
  });
});

describe('a window keeps its identity across midnight (R3)', () => {
  // OSCAR's repro used 50 minutes, which the settings validator accepted and
  // which does not divide 1,440. Two things are asserted here: that length is
  // now refused outright, and a *supported* non-hourly length crosses midnight
  // without losing a window.
  // A full-day window: the identity property is about the grid, and the
  // opening hours are a filter over it (see the next describe).
  const fortyFive = {
    slotLengthMinutes: 45,
    timeZone: IST,
    horizonDays: 3,
    leadMinutes: 120,
    openMinuteOfDay: 0,
    closeMinuteOfDay: 1440,
  };

  it('refuses a length that does not divide the day', () => {
    for (const bad of [50, 7, 13, 100, 1_441]) {
      expect(() => assertSlotLength(bad)).toThrow(/divide the day/i);
      expect(() => slotGrid({ ...fortyFive, slotLengthMinutes: bad, from: new Date() })).toThrow(
        /divide the day/i,
      );
    }
  });

  it('accepts the lengths a shop would actually use', () => {
    for (const good of [15, 20, 30, 45, 60, 90, 120, 240, 720, 1_440]) {
      expect(() => assertSlotLength(good)).not.toThrow();
    }
  });

  it('offers every still-future window from the earlier grid in the later one', () => {
    // The property that matters: crossing local midnight may *add* windows, but
    // must never silently retire one a shopper was already shown — or had
    // already booked.
    const before = slotGrid({ ...fortyFive, from: new Date('2026-12-01T17:30:00Z') });
    const after = slotGrid({ ...fortyFive, from: new Date('2026-12-01T18:31:00Z') });
    const laterEarliest = new Date('2026-12-01T18:31:00Z').getTime() + 120 * 60_000;
    const afterSet = new Set(after.map((slot) => slot.getTime()));

    const vanished = before
      .filter((slot) => slot.getTime() >= laterEarliest)
      .filter((slot) => !afterSet.has(slot.getTime()));

    expect(vanished.map((slot) => slot.toISOString())).toEqual([]);
  });

  it('starts each day on that day’s own local midnight', () => {
    const slots = slotGrid({ ...fortyFive, from: new Date('2026-12-01T00:00:00Z') });
    const firstOfEachLocalDay = new Map<string, Date>();
    for (const slot of slots) {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: IST }).format(slot);
      if (!firstOfEachLocalDay.has(day)) firstOfEachLocalDay.set(day, slot);
    }

    // Every day begins at 00:00 local, so no day inherits the previous day's
    // offset. The first day is the exception: it starts wherever the lead time
    // lands within the day already in progress.
    const days = [...firstOfEachLocalDay.entries()].slice(1);
    expect(days.length).toBeGreaterThan(0);
    for (const [, first] of days) {
      expect(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: IST,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(first),
      ).toBe('00:00');
    }
  });

  it('never offers two windows that overlap, across the day boundary included', () => {
    // The capacity key is `<storeId>:<slotStart>`, so two overlapping windows
    // would count the same minutes under two different keys. This is what a
    // non-divisor length breaks even with per-day anchoring — 23:20-00:10
    // against 00:00-00:50 — and why the length is now refused rather than
    // accommodated.
    for (const length of [30, 45, 60, 90]) {
      const slots = slotGrid({
        ...fortyFive,
        slotLengthMinutes: length,
        from: new Date('2026-12-01T00:00:00Z'),
      });
      for (let i = 1; i < slots.length; i += 1) {
        expect(slots[i]!.getTime() - slots[i - 1]!.getTime()).toBeGreaterThanOrEqual(
          length * 60_000,
        );
      }
    }
  });

  it('is unchanged for the hourly grid the shops actually run', () => {
    const hourly = { ...fortyFive, slotLengthMinutes: 60, horizonDays: 2 };
    const before = slotGrid({ ...hourly, from: new Date('2026-12-01T17:30:00Z') });
    const after = slotGrid({ ...hourly, from: new Date('2026-12-01T18:31:00Z') });
    const laterEarliest = new Date('2026-12-01T18:31:00Z').getTime() + 120 * 60_000;
    const afterSet = new Set(after.map((slot) => slot.getTime()));

    expect(
      before.filter((s) => s.getTime() >= laterEarliest).every((s) => afterSet.has(s.getTime())),
    ).toBe(true);
    for (const slot of after) expect((slot.getTime() + 5.5 * 3_600_000) % 3_600_000).toBe(0);
  });
});

describe('opening hours — only windows inside them are offered', () => {
  const hours = {
    slotLengthMinutes: 60,
    timeZone: IST,
    horizonDays: 1,
    leadMinutes: 0,
    openMinuteOfDay: 600,
    closeMinuteOfDay: 1200,
  };
  const istWallClock = (slot: Date): string =>
    new Intl.DateTimeFormat('en-GB', {
      timeZone: IST,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(slot);

  it('offers 10:00 through 19:00 and nothing outside, on the store’s wall clock', () => {
    // Midnight IST, one day: exactly the ten hourly windows 10:00–19:00.
    const slots = slotGrid({ ...hours, from: new Date('2026-02-28T18:30:00Z') });
    expect(slots.map(istWallClock)).toEqual([
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00',
      '18:00',
      '19:00',
    ]);
  });

  it('keeps a window only if it ends by closing time', () => {
    // 90-minute windows are anchored to midnight (00:00, 01:30, … 09:00,
    // 10:30, …), so inside 10:00–20:00 the first is 10:30, not 10:00, and the
    // last is 18:00 (ends 19:30): 19:30 would end at 21:00, past the door.
    const slots = slotGrid({
      ...hours,
      slotLengthMinutes: 90,
      from: new Date('2026-02-28T18:30:00Z'),
    });
    expect(slots.map(istWallClock)).toEqual(['10:30', '12:00', '13:30', '15:00', '16:30', '18:00']);
  });

  it('is a filter over the anchored grid, not a new anchor', () => {
    // Every window inside the hours is exactly one the full-day grid offers.
    const from = new Date('2026-03-01T06:00:00Z');
    const all = new Set(
      slotGrid({ ...hours, from, openMinuteOfDay: 0, closeMinuteOfDay: 1440 }).map((s) =>
        s.toISOString(),
      ),
    );
    const inside = slotGrid({ ...hours, from });
    expect(inside.length).toBeGreaterThan(0);
    for (const slot of inside) expect(all.has(slot.toISOString())).toBe(true);
  });

  it('composes with DST: the hours stay on the wall clock across a spring-forward', () => {
    // London, 29 March 2026: 01:00 → 02:00. The local day is 23 hours long,
    // the grid is still anchored to that day's midnight, and 10:00–20:00 must
    // still mean 10:00–20:00 on the wall — not 09:00–19:00 or 11:00–21:00.
    const londonWallClock = (slot: Date): string =>
      new Intl.DateTimeFormat('en-GB', {
        timeZone: LONDON,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(slot);
    const slots = slotGrid({
      ...hours,
      timeZone: LONDON,
      from: new Date('2026-03-29T00:00:00Z'), // local midnight of the shift day
    });
    expect(slots.map(londonWallClock)).toEqual([
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
      '16:00',
      '17:00',
      '18:00',
      '19:00',
    ]);
    // …and the first is the real instant 10:00 BST = 09:00 UTC.
    expect(slots[0]).toEqual(new Date('2026-03-29T09:00:00Z'));
  });

  it('judges the window’s real end on the wall clock, not start + length (OSCAR M2)', () => {
    // Europe/London, 2026-03-29, hours 00:00–01:00. The 60-minute window at
    // local 00:00 (00:00Z) ends at 01:00Z, which the wall clock calls 02:00 —
    // the shift happened inside it. Start + 60 minutes says 01:00 and would
    // offer it; the door had been shut an hour by then.
    const shiftNight = slotGrid({
      ...hours,
      timeZone: 'Europe/London',
      openMinuteOfDay: 0,
      closeMinuteOfDay: 60,
      from: new Date('2026-03-29T00:00:00Z'),
    });
    expect(shiftNight.map((s) => s.toISOString())).not.toContain('2026-03-29T00:00:00.000Z');
    // The same window the night after is a plain hour and is offered.
    expect(shiftNight.map((s) => s.toISOString())).toContain('2026-03-29T23:00:00.000Z');

    // Hours wide enough to hold the stretched window still offer it: 00:00
    // to 02:00 on the wall holds a window that ends at 02:00 on the wall.
    const wider = slotGrid({
      ...hours,
      timeZone: 'Europe/London',
      openMinuteOfDay: 0,
      closeMinuteOfDay: 120,
      from: new Date('2026-03-29T00:00:00Z'),
    });
    expect(wider.map((s) => s.toISOString())).toContain('2026-03-29T00:00:00.000Z');

    // A window that ends exactly at midnight belongs to its own day.
    const toMidnight = slotGrid({
      ...hours,
      openMinuteOfDay: 1380,
      closeMinuteOfDay: 1440,
      from: new Date('2026-02-28T18:30:00Z'),
    });
    expect(toMidnight.map(istWallClock)).toEqual(['23:00']);
  });

  it('refuses hours that are not a whole-minute window inside one day', () => {
    const from = new Date('2026-03-01T06:00:00Z');
    for (const [open, close] of [
      [600, 600],
      [1200, 600],
      [-1, 1200],
      [600, 1441],
      [600.5, 1200],
      [600, 630],
    ] as const) {
      expect(() =>
        slotGrid({ ...hours, from, openMinuteOfDay: open, closeMinuteOfDay: close }),
      ).toThrow(/opening hours/i);
    }
    expect(assertOpeningHours(600, 660, 60)).toBeUndefined();
    expect(assertOpeningHours(0, 1440, 60)).toBeUndefined();
  });
});

describe('isBookableSlot', () => {
  const grid = {
    from: new Date('2026-03-01T06:00:00Z'),
    slotLengthMinutes: 60,
    timeZone: IST,
    horizonDays: 1,
    leadMinutes: 120,
    openMinuteOfDay: 600,
    closeMinuteOfDay: 1200,
  };

  it('accepts a slot the grid offers', () => {
    expect(isBookableSlot(new Date('2026-03-01T08:30:00Z'), grid)).toBe(true);
  });

  it('refuses one inside the lead time', () => {
    expect(isBookableSlot(new Date('2026-03-01T06:30:00Z'), grid)).toBe(false);
  });

  it('refuses one beyond the horizon', () => {
    expect(isBookableSlot(new Date('2026-03-05T08:30:00Z'), grid)).toBe(false);
  });

  it('refuses one off the grid', () => {
    expect(isBookableSlot(new Date('2026-03-01T09:00:00Z'), grid)).toBe(false);
  });

  it('refuses an unparseable date', () => {
    expect(isBookableSlot(new Date('nonsense'), grid)).toBe(false);
  });
});

describe('slotEndOf', () => {
  it('closes the window a slot length later', () => {
    expect(slotEndOf(new Date('2026-03-01T08:30:00Z'), 60)).toEqual(
      new Date('2026-03-01T09:30:00Z'),
    );
  });
});
