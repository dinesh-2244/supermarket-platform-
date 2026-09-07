import { describe, expect, it } from 'vitest';
import { add, format, fromRupees, max, min, mul, paise, percentBp, subtract } from '../money/index';
import { ValidationError } from '../errors/index';

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

  // R4: the tie has to be resolved on the decimal the caller wrote. 10.075 is
  // held in binary as 10.0749999999999992894…, so `Math.round(r * 100)` rounds
  // *down* and silently loses a paisa on every such price.
  it('rounds decimal half ties up rather than following the binary value', () => {
    expect(fromRupees(10.075)).toBe(1008);
    expect(fromRupees(1.005)).toBe(101);
    expect(fromRupees(2.675)).toBe(268);
    expect(fromRupees(8.165)).toBe(817);
    expect(fromRupees(0.005)).toBe(1);
    expect(fromRupees(0.004999)).toBe(0);
  });

  it('rounds negative amounts half away from zero, symmetrically', () => {
    expect(fromRupees(-10.075)).toBe(-1008);
    expect(fromRupees(-1.005)).toBe(-101);
    expect(fromRupees(-19.99)).toBe(-1999);
    expect(mul(paise(100), -10.075)).toBe(-1008);
    expect(mul(paise(-100), 10.075)).toBe(-1008);
  });

  it('handles rupee inputs written in exponent notation', () => {
    expect(fromRupees(1e-3)).toBe(0);
    expect(fromRupees(5e-3)).toBe(1);
    expect(fromRupees(1.5e3)).toBe(150_000);
  });

  it('adds and subtracts exactly', () => {
    expect(add(paise(1999), paise(1), paise(100))).toBe(2100);
    expect(subtract(paise(5000), paise(1250))).toBe(3750);
    expect(add()).toBe(0);
    expect(max(paise(10), paise(20))).toBe(20);
  });

  it('multiplies by a quantity and rounds half-up', () => {
    expect(mul(paise(1999), 3)).toBe(5997);
    expect(mul(paise(333), 1 / 3)).toBe(111);
    expect(mul(paise(5), 0.5)).toBe(3);
    expect(mul(paise(100), 10.075)).toBe(1008);
    expect(mul(paise(2), 1.25)).toBe(3);
    expect(mul(paise(0), 99.999)).toBe(0);
  });

  it('computes basis points for the price-variance threshold', () => {
    // Architecture §11 R6: threshold = lower of 5% or ₹50.
    const estimate = paise(200_000); // ₹2,000
    const fivePercent = percentBp(estimate, 500);
    const absCap = paise(5000);

    expect(fivePercent).toBe(10_000);
    expect(min(fivePercent, absCap)).toBe(5000);
  });

  it('computes basis points exactly, including half ties', () => {
    // 1 paisa at 5000bp is exactly 0.5 paise — a tie, so it rounds up.
    expect(percentBp(paise(1), 5000)).toBe(1);
    expect(percentBp(paise(1), 4999)).toBe(0);
    expect(percentBp(paise(999), 1)).toBe(0);
    expect(percentBp(paise(12_345), 1234)).toBe(1523); // 1523.373 → 1523
    expect(percentBp(paise(-200_000), 500)).toBe(-10_000);
  });

  // R4: the result of an exact multiplication can still overflow the range a
  // JS number can represent losslessly. That must be an error, not a wrong total.
  it('accepts the safe-integer boundary and rejects anything past it', () => {
    const maxSafe = paise(Number.MAX_SAFE_INTEGER);

    expect(add(maxSafe)).toBe(Number.MAX_SAFE_INTEGER);
    expect(subtract(maxSafe, paise(1))).toBe(Number.MAX_SAFE_INTEGER - 1);
    expect(mul(maxSafe, 1)).toBe(Number.MAX_SAFE_INTEGER);

    expect(() => paise(Number.MAX_SAFE_INTEGER + 1)).toThrow(ValidationError);
    expect(() => add(maxSafe, paise(1))).toThrow(ValidationError);
    expect(() => mul(maxSafe, 2)).toThrow(ValidationError);
    expect(() => subtract(paise(-Number.MAX_SAFE_INTEGER), paise(1))).toThrow(ValidationError);
    expect(() => fromRupees(Number.MAX_SAFE_INTEGER)).toThrow(ValidationError);
  });

  it('rejects non-finite factors', () => {
    expect(() => fromRupees(Number.POSITIVE_INFINITY)).toThrow(ValidationError);
    expect(() => mul(paise(100), Number.NaN)).toThrow(ValidationError);
    expect(() => percentBp(paise(100), Number.POSITIVE_INFINITY)).toThrow(ValidationError);
  });

  it('formats INR', () => {
    expect(format(paise(123_450))).toBe('₹1,234.50');
    expect(format(paise(0))).toBe('₹0.00');
  });
});
