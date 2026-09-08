import { describe, expect, it } from 'vitest';
import {
  assertQuantity,
  descriptor,
  issuesFor,
  MAX_LINE_QUANTITY,
  totalsFor,
  type CartLine,
} from '../domain/index';

/**
 * The pure half of the basket: what has to be *said* about a line, given what
 * the store says now. Written without a database so the awkward combinations —
 * a price that moved and stock that ran short on the same line — are cheap to
 * pin down.
 */
function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    productId: 'p1',
    name: 'Rice',
    slug: 'rice',
    brand: null,
    packSize: '1 kg',
    qty: 2,
    unitPricePaise: 10_000,
    mrpPaise: 11_000,
    lineTotalPaise: 20_000,
    issues: [],
    ...overrides,
  };
}

describe('cart — module descriptor (§4)', () => {
  it('declares what it owns and may depend on', () => {
    expect(descriptor.name).toBe('cart');
    // A basket reads the catalogue, prices and stock; it owns neither orders
    // nor the ledger, and must never grow a dependency on them here.
    expect(descriptor.dependsOn).toEqual(['platform', 'catalog', 'pricing', 'inventory', 'stores']);
    expect(descriptor.dependsOn).not.toContain('orders');
    expect(descriptor.emits).toEqual([]);
  });
});

describe('cart — quantity is the one number the client supplies', () => {
  it('accepts a sensible whole number', () => {
    expect(() => {
      assertQuantity(1);
    }).not.toThrow();
    expect(() => {
      assertQuantity(MAX_LINE_QUANTITY);
    }).not.toThrow();
  });

  it('refuses zero, negatives, fractions and absurd amounts', () => {
    // Zero is not a quantity — it is a removal, and says so.
    expect(() => {
      assertQuantity(0);
    }).toThrow(/at least 1/i);
    expect(() => {
      assertQuantity(-1);
    }).toThrow(/at least 1/i);
    expect(() => {
      assertQuantity(2.5);
    }).toThrow(/whole number/i);
    expect(() => {
      assertQuantity(Number.NaN);
    }).toThrow(/whole number/i);
    expect(() => {
      assertQuantity(MAX_LINE_QUANTITY + 1);
    }).toThrow(/more than/i);
  });
});

describe('cart — what has to be said about a line', () => {
  it('says nothing when the store agrees with the basket', () => {
    expect(
      issuesFor({ snapshotPricePaise: 100, currentPricePaise: 100, qty: 2, available: 10 }),
    ).toEqual([]);
  });

  it('reports a price move in both directions, with both numbers', () => {
    expect(
      issuesFor({ snapshotPricePaise: 100, currentPricePaise: 130, qty: 1, available: 10 }),
    ).toEqual([{ kind: 'price-changed', oldPricePaise: 100, newPricePaise: 130 }]);
    // A price that fell is still a change worth telling the shopper about.
    expect(
      issuesFor({ snapshotPricePaise: 130, currentPricePaise: 100, qty: 1, available: 10 }),
    ).toEqual([{ kind: 'price-changed', oldPricePaise: 130, newPricePaise: 100 }]);
  });

  it('flags a shortfall with the number available, and never caps', () => {
    const issues = issuesFor({
      snapshotPricePaise: 100,
      currentPricePaise: 100,
      qty: 12,
      available: 8,
    });
    expect(issues).toEqual([{ kind: 'insufficient-stock', available: 8 }]);
  });

  it('distinguishes "not enough" from "none at all"', () => {
    expect(
      issuesFor({ snapshotPricePaise: 100, currentPricePaise: 100, qty: 3, available: 0 }),
    ).toEqual([{ kind: 'out-of-stock' }]);
    // Exactly enough is not a shortfall.
    expect(
      issuesFor({ snapshotPricePaise: 100, currentPricePaise: 100, qty: 3, available: 3 }),
    ).toEqual([]);
  });

  it('reports both problems when a line has both', () => {
    expect(
      issuesFor({ snapshotPricePaise: 100, currentPricePaise: 150, qty: 5, available: 2 }),
    ).toEqual([
      { kind: 'price-changed', oldPricePaise: 100, newPricePaise: 150 },
      { kind: 'insufficient-stock', available: 2 },
    ]);
  });
});

describe('cart — totals', () => {
  it('adds up lines and counts items, not lines', () => {
    const totals = totalsFor([line(), line({ productId: 'p2', qty: 3, lineTotalPaise: 15_000 })], {
      deliveryFeePaise: 3_000,
      minOrderPaise: 20_000,
    });
    expect(totals.subtotalPaise).toBe(35_000);
    expect(totals.itemCount).toBe(5);
    expect(totals.meetsMinimum).toBe(true);
  });

  it('is empty for an empty basket rather than undefined', () => {
    expect(totalsFor([], { deliveryFeePaise: 3_000, minOrderPaise: 20_000 })).toEqual({
      subtotalPaise: 0,
      itemCount: 0,
      deliveryFeePaise: 3_000,
      minOrderPaise: 20_000,
      meetsMinimum: false,
    });
  });

  it('counts an out-of-stock line towards the subtotal', () => {
    // It is still in the basket. Excluding it would make the total jump the
    // moment the shopper fixed the line.
    const totals = totalsFor([line({ issues: [{ kind: 'out-of-stock' }] })], {
      deliveryFeePaise: 3_000,
      minOrderPaise: 20_000,
    });
    expect(totals.subtotalPaise).toBe(20_000);
  });

  it('treats exactly the minimum as met', () => {
    expect(
      totalsFor([line({ lineTotalPaise: 20_000 })], {
        deliveryFeePaise: 3_000,
        minOrderPaise: 20_000,
      }).meetsMinimum,
    ).toBe(true);
  });
});
