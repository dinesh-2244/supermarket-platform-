import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../platform/index';
import { assertPrice, descriptor, discountBp, priceChanged } from '../domain/index';
import { moduleDescriptor } from '../service';

describe('pricing module descriptor', () => {
  it('declares what it owns and emits', () => {
    expect(moduleDescriptor()).toEqual(descriptor);
    expect(descriptor.emits).toEqual(['price.changed']);
    expect(descriptor.dependsOn).toEqual(['platform', 'catalog', 'stores']);
  });
});

describe('pricing/domain — price validation', () => {
  it('accepts a selling price at or below MRP', () => {
    expect(() => {
      assertPrice({ mrpPaise: 12_000, sellingPricePaise: 9_500 });
    }).not.toThrow();
    expect(() => {
      assertPrice({ mrpPaise: 12_000, sellingPricePaise: 12_000 });
    }).not.toThrow();
  });

  // Selling above the Maximum Retail Price printed on the pack is illegal in
  // India, and a misplaced decimal does it silently.
  it('refuses a selling price above MRP', () => {
    expect(() => {
      assertPrice({ mrpPaise: 12_000, sellingPricePaise: 12_001 });
    }).toThrow(/above MRP/i);
  });

  it('refuses zero, negative and non-integer prices', () => {
    for (const bad of [
      { mrpPaise: 0, sellingPricePaise: 0 },
      { mrpPaise: 100, sellingPricePaise: 0 },
      { mrpPaise: 100, sellingPricePaise: -1 },
      { mrpPaise: -100, sellingPricePaise: -200 },
      { mrpPaise: 100.5, sellingPricePaise: 100 },
      { mrpPaise: 100, sellingPricePaise: 99.99 },
      { mrpPaise: Number.NaN, sellingPricePaise: 1 },
    ]) {
      expect(() => {
        assertPrice(bad);
      }).toThrow(ValidationError);
    }
  });
});

describe('pricing/domain — change detection', () => {
  it('spots a move in either field', () => {
    const base = { mrpPaise: 12_000, sellingPricePaise: 9_500 };
    expect(priceChanged(base, base)).toBe(false);
    expect(priceChanged(base, { ...base, sellingPricePaise: 9_400 })).toBe(true);
    expect(priceChanged(base, { ...base, mrpPaise: 12_500 })).toBe(true);
  });
});

describe('pricing/domain — discount', () => {
  it('reports the discount in basis points', () => {
    expect(discountBp({ mrpPaise: 10_000, sellingPricePaise: 9_000 })).toBe(1000);
    expect(discountBp({ mrpPaise: 10_000, sellingPricePaise: 10_000 })).toBe(0);
    expect(discountBp({ mrpPaise: 0, sellingPricePaise: 0 })).toBe(0);
  });
});
