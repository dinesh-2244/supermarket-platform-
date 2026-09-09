import { describe, expect, it } from 'vitest';
import {
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
    expect(slots.length).toBeGreaterThan(24);
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

    expect(new Set(gaps)).toEqual(new Set([30 * 60_000]));
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
    });
    expect(slots.length).toBeGreaterThan(60);
  });
});

describe('isBookableSlot', () => {
  const grid = {
    from: new Date('2026-03-01T06:00:00Z'),
    slotLengthMinutes: 60,
    timeZone: IST,
    horizonDays: 1,
    leadMinutes: 120,
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
