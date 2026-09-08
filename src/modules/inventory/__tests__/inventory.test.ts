import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../platform/index';
import {
  ADMIN_REASONS,
  assertQuantity,
  crossedLowThresholdDownward,
  descriptor,
  isLow,
  nextBalance,
  reconcileDelta,
  STOCK_REASONS,
} from '../domain/index';
import { moduleDescriptor } from '../service';

describe('inventory module descriptor', () => {
  it('declares what it owns and emits', () => {
    expect(moduleDescriptor()).toEqual(descriptor);
    expect(descriptor.emits).toEqual(['stock.low', 'stock.changed']);
  });

  // Phase 2 only triggers three of these; the rest are accepted by the write API
  // so Phase 4/5 add callers rather than reopening the stock write.
  it('knows every ledger reason, and which three an admin may use now', () => {
    expect(STOCK_REASONS).toHaveLength(7);
    expect(ADMIN_REASONS).toEqual(['MANUAL_ADJUST', 'RECONCILE', 'CSV_IMPORT']);
    for (const reason of ADMIN_REASONS) {
      expect(STOCK_REASONS).toContain(reason);
    }
  });
});

describe('inventory/domain — nextBalance', () => {
  it('adds and subtracts', () => {
    expect(nextBalance(100, -12)).toBe(88);
    expect(nextBalance(0, 5)).toBe(5);
    expect(nextBalance(5, -5)).toBe(0);
  });

  // websiteStock is "available to sell": a negative one either gets clamped to a
  // positive number somewhere and oversells, or shows a customer nonsense.
  it('refuses to go below zero', () => {
    expect(() => nextBalance(10, -11)).toThrow(/below zero/i);
    expect(() => nextBalance(0, -1)).toThrow(/below zero/i);
  });

  it('refuses a zero or fractional movement', () => {
    expect(() => nextBalance(10, 0)).toThrow(/changes nothing/i);
    expect(() => nextBalance(10, 1.5)).toThrow(/whole number/i);
    expect(() => nextBalance(10, Number.NaN)).toThrow(ValidationError);
  });

  it('refuses a result outside the safe integer range', () => {
    expect(() => nextBalance(Number.MAX_SAFE_INTEGER, 1)).toThrow(ValidationError);
  });
});

describe('inventory/domain — reconcileDelta', () => {
  it('is the signed difference to the counted quantity', () => {
    expect(reconcileDelta(100, 73)).toBe(-27);
    expect(reconcileDelta(10, 25)).toBe(15);
    expect(reconcileDelta(10, 10)).toBe(0);
  });

  it('refuses a negative or fractional count', () => {
    expect(() => reconcileDelta(10, -1)).toThrow(ValidationError);
    expect(() => reconcileDelta(10, 2.5)).toThrow(ValidationError);
  });
});

describe('inventory/domain — low stock', () => {
  it('is low at or below the threshold', () => {
    expect(isLow(5, 5)).toBe(true);
    expect(isLow(4, 5)).toBe(true);
    expect(isLow(6, 5)).toBe(false);
  });

  // Only the crossing fires an alert; otherwise every sale of an already-low
  // item alerts again and the alert stops meaning anything.
  it('detects only a downward crossing', () => {
    expect(crossedLowThresholdDownward(6, 5, 5)).toBe(true);
    expect(crossedLowThresholdDownward(100, 0, 5)).toBe(true);
    expect(crossedLowThresholdDownward(5, 4, 5)).toBe(false);
    expect(crossedLowThresholdDownward(4, 6, 5)).toBe(false);
    expect(crossedLowThresholdDownward(6, 7, 5)).toBe(false);
  });
});

describe('inventory/domain — quantities', () => {
  it('accepts zero and positive whole numbers only', () => {
    expect(assertQuantity(0)).toBe(0);
    expect(assertQuantity(42)).toBe(42);
    expect(() => assertQuantity(-1)).toThrow(ValidationError);
    expect(() => assertQuantity(1.5)).toThrow(ValidationError);
  });
});
