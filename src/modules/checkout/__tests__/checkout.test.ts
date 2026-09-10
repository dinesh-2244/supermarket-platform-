import { describe, expect, it } from 'vitest';
import { assertPaymentMethod, moduleDescriptor, PAYMENT_METHODS, shortfallsIn } from '../index';

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
