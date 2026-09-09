import { describe, expect, it } from 'vitest';
import {
  assertPaymentMethod,
  assertSlotShape,
  isOnSlotGrid,
  moduleDescriptor,
  PAYMENT_METHODS,
  shortfallsIn,
  slotEnd,
} from '../index';

describe('checkout module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('checkout');
    expect(descriptor.dependsOn).toEqual([
      'platform',
      'cart',
      'orders',
      'inventory',
      'stores',
      'customers',
    ]);
    expect(descriptor.emits).toEqual(['order.placed']);
  });
});

describe('payment method', () => {
  it('accepts the two Phase 4 choices', () => {
    expect(assertPaymentMethod('COD')).toBe('COD');
    expect(assertPaymentMethod('UPI_ON_DELIVERY')).toBe('UPI_ON_DELIVERY');
    expect(PAYMENT_METHODS).toHaveLength(2);
  });

  it('refuses anything else, including a gateway that does not exist yet', () => {
    for (const value of ['CARD', 'PREPAID', 'RAZORPAY', '', 'cod']) {
      expect(() => assertPaymentMethod(value)).toThrow(/how you will pay/i);
    }
  });
});

describe('slot arithmetic', () => {
  it('ends a slot one slot-length after it starts', () => {
    expect(slotEnd(new Date('2026-03-01T10:00:00Z'), 60)).toEqual(new Date('2026-03-01T11:00:00Z'));
    expect(slotEnd(new Date('2026-03-01T10:00:00Z'), 30)).toEqual(new Date('2026-03-01T10:30:00Z'));
  });

  it('puts hourly slots on the hour, anchored to midnight', () => {
    expect(isOnSlotGrid(new Date('2026-03-01T00:00:00Z'), 60)).toBe(true);
    expect(isOnSlotGrid(new Date('2026-03-01T10:00:00Z'), 60)).toBe(true);
    expect(isOnSlotGrid(new Date('2026-03-01T23:00:00Z'), 60)).toBe(true);
    expect(isOnSlotGrid(new Date('2026-03-01T10:30:00Z'), 60)).toBe(false);
    expect(isOnSlotGrid(new Date('2026-03-01T10:00:01Z'), 60)).toBe(false);
  });

  it('follows a store that uses half-hour windows', () => {
    expect(isOnSlotGrid(new Date('2026-03-01T10:30:00Z'), 30)).toBe(true);
    expect(isOnSlotGrid(new Date('2026-03-01T10:45:00Z'), 30)).toBe(false);
  });

  it('treats a nonsense slot length as no grid at all', () => {
    expect(isOnSlotGrid(new Date('2026-03-01T10:00:00Z'), 0)).toBe(false);
    expect(isOnSlotGrid(new Date('2026-03-01T10:00:00Z'), -60)).toBe(false);
  });

  it('is the same grid regardless of when it is asked', () => {
    // The reason the grid is anchored to midnight rather than to "now": two
    // shoppers a minute apart must be offered the same windows, or the capacity
    // count inside placeOrder would be counting different things for each.
    const slot = new Date('2026-03-01T14:00:00Z');
    expect(isOnSlotGrid(slot, 60)).toBe(true);
    expect(isOnSlotGrid(slot, 60)).toBe(true);
  });
});

describe('assertSlotShape', () => {
  const now = new Date('2026-03-01T09:15:00Z');

  it('accepts a future slot on the grid', () => {
    expect(() =>
      assertSlotShape({ start: new Date('2026-03-01T11:00:00Z'), slotLengthMinutes: 60, now }),
    ).not.toThrow();
  });

  it('refuses a slot off the grid', () => {
    expect(() =>
      assertSlotShape({ start: new Date('2026-03-01T11:20:00Z'), slotLengthMinutes: 60, now }),
    ).toThrow(/delivery windows/i);
  });

  it('refuses a slot that has already started, and the current one', () => {
    expect(() =>
      assertSlotShape({ start: new Date('2026-03-01T08:00:00Z'), slotLengthMinutes: 60, now }),
    ).toThrow(/already started/i);
    expect(() =>
      assertSlotShape({ start: new Date('2026-03-01T09:00:00Z'), slotLengthMinutes: 60, now }),
    ).toThrow(/already started/i);
  });

  it('refuses an unparseable date', () => {
    expect(() =>
      assertSlotShape({ start: new Date('not a date'), slotLengthMinutes: 60, now }),
    ).toThrow(/choose a delivery slot/i);
  });
});

describe('shortfallsIn', () => {
  const line = (
    productId: string,
    name: string,
    issues: readonly ({ kind: string } & { available?: number })[],
  ) => ({ productId, name, issues });

  it('finds nothing wrong with a clean basket', () => {
    expect(shortfallsIn({ lines: [line('p1', 'Rice', [])], removed: [] })).toEqual([]);
  });

  it('reports an out-of-stock line', () => {
    expect(
      shortfallsIn({ lines: [line('p1', 'Rice', [{ kind: 'out-of-stock' }])], removed: [] }),
    ).toEqual([{ productId: 'p1', name: 'Rice', reason: 'out-of-stock' }]);
  });

  it('reports a short line with how many are left', () => {
    expect(
      shortfallsIn({
        lines: [line('p1', 'Rice', [{ kind: 'insufficient-stock', available: 2 }])],
        removed: [],
      }),
    ).toEqual([{ productId: 'p1', name: 'Rice', reason: 'insufficient-stock', available: 2 }]);
  });

  it('omits the count when the cart did not say one', () => {
    expect(
      shortfallsIn({
        lines: [line('p1', 'Rice', [{ kind: 'insufficient-stock' }])],
        removed: [],
      }),
    ).toEqual([{ productId: 'p1', name: 'Rice', reason: 'insufficient-stock' }]);
  });

  it('does NOT treat a price change as a shortfall', () => {
    // The line already carries the current price and the shopper is quoted from
    // it. A moved price is shown, not refused — refusing it would make an
    // ordinary Tuesday price update look like an outage.
    expect(
      shortfallsIn({
        lines: [
          line('p1', 'Rice', [
            { kind: 'price-changed', oldPricePaise: 100, newPricePaise: 120 } as never,
          ]),
        ],
        removed: [],
      }),
    ).toEqual([]);
  });

  it('reports a line the revalidation removed', () => {
    expect(shortfallsIn({ lines: [], removed: [{ productId: 'p9', name: 'Ghee' }] })).toEqual([
      { productId: 'p9', name: 'Ghee', reason: 'unlisted' },
    ]);
  });

  it('reports every reason on a basket with several problems', () => {
    const result = shortfallsIn({
      lines: [
        line('p1', 'Rice', [{ kind: 'insufficient-stock', available: 1 }]),
        line('p2', 'Dal', [{ kind: 'out-of-stock' }]),
        line('p3', 'Oil', []),
      ],
      removed: [{ productId: 'p4', name: 'Ghee' }],
    });

    expect(result.map((entry) => entry.productId)).toEqual(['p1', 'p2', 'p4']);
  });

  it('reports both issues when one line has two', () => {
    const result = shortfallsIn({
      lines: [
        line('p1', 'Rice', [
          { kind: 'price-changed' },
          { kind: 'insufficient-stock', available: 3 },
        ]),
      ],
      removed: [],
    });

    expect(result).toEqual([
      { productId: 'p1', name: 'Rice', reason: 'insufficient-stock', available: 3 },
    ]);
  });
});
