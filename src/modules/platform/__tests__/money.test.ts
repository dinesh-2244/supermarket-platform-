import { describe, expect, it } from 'vitest';
import { add, format, fromRupees, min, mul, paise, percentBp, subtract } from '../money/index.js';
import { ValidationError } from '../errors/index.js';

describe('platform/money', () => {
  it('rejects non-integer paise', () => {
    expect(() => paise(10.5)).toThrow(ValidationError);
    expect(() => paise(Number.NaN)).toThrow(ValidationError);
  });

  it('converts rupees to paise without float drift', () => {
    expect(fromRupees(19.99)).toBe(1999);
    expect(fromRupees(0.1 + 0.2)).toBe(30);
    expect(fromRupees(1234.567)).toBe(123457);
  });

  it('adds and subtracts exactly', () => {
    expect(add(paise(1999), paise(1), paise(100))).toBe(2100);
    expect(subtract(paise(5000), paise(1250))).toBe(3750);
    expect(add()).toBe(0);
  });

  it('multiplies by a quantity and rounds half-up', () => {
    expect(mul(paise(1999), 3)).toBe(5997);
    expect(mul(paise(333), 1 / 3)).toBe(111);
    expect(mul(paise(5), 0.5)).toBe(3);
  });

  it('computes basis points for the price-variance threshold', () => {
    // Architecture §11 R6: threshold = lower of 5% or ₹50.
    const estimate = paise(200_000); // ₹2,000
    const fivePercent = percentBp(estimate, 500);
    const absCap = paise(5000);

    expect(fivePercent).toBe(10_000);
    expect(min(fivePercent, absCap)).toBe(5000);
  });

  it('formats INR', () => {
    expect(format(paise(123_450))).toBe('₹1,234.50');
    expect(format(paise(0))).toBe('₹0.00');
  });
});
