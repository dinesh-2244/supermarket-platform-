import { describe, expect, it } from 'vitest';
import { restoreQuantity, validateLineOutcome } from '../domain/index';

/**
 * The restore arithmetic is the one place in Phase 5 where real stock can be
 * created or lost, so every branch of it is proved here with no database.
 */
describe('restoreQuantity — what a short or unavailable line gives back', () => {
  it('returns the unpicked remainder that has not already been restored', () => {
    expect(restoreQuantity({ qtyOrdered: 5, qtyPicked: 2, stockRestoredQty: 0 })).toBe(3);
    expect(restoreQuantity({ qtyOrdered: 5, qtyPicked: 0, stockRestoredQty: 0 })).toBe(5);
  });

  it('never restores what an earlier restore already gave back', () => {
    expect(restoreQuantity({ qtyOrdered: 5, qtyPicked: 2, stockRestoredQty: 3 })).toBe(0);
    expect(restoreQuantity({ qtyOrdered: 5, qtyPicked: 0, stockRestoredQty: 2 })).toBe(3);
  });

  it('is never negative, whatever the inputs', () => {
    expect(restoreQuantity({ qtyOrdered: 5, qtyPicked: 5, stockRestoredQty: 0 })).toBe(0);
    expect(restoreQuantity({ qtyOrdered: 5, qtyPicked: 4, stockRestoredQty: 4 })).toBe(0);
    expect(restoreQuantity({ qtyOrdered: 2, qtyPicked: 3, stockRestoredQty: 0 })).toBe(0);
  });
});

describe('validateLineOutcome — what each outcome must look like', () => {
  const ordered = 4;

  it('PICKED means the whole quantity, and no substitute', () => {
    expect(validateLineOutcome(ordered, { outcome: 'PICKED', qtyPicked: 4 })).toEqual({
      lineStatus: 'PICKED',
      qtyPicked: 4,
      substituteProductId: null,
      restores: false,
      restoreBasis: 4,
    });
    expect(() => validateLineOutcome(ordered, { outcome: 'PICKED', qtyPicked: 3 })).toThrow(
      /short/i,
    );
    expect(() =>
      validateLineOutcome(ordered, { outcome: 'PICKED', qtyPicked: 4, substituteProductId: 'p' }),
    ).toThrow(/substitute/i);
  });

  it('SHORT means some but not all, and restores the rest', () => {
    expect(validateLineOutcome(ordered, { outcome: 'SHORT', qtyPicked: 1 })).toMatchObject({
      lineStatus: 'SHORT',
      qtyPicked: 1,
      restores: true,
      restoreBasis: 1,
    });
    expect(() => validateLineOutcome(ordered, { outcome: 'SHORT', qtyPicked: 0 })).toThrow(
      /unavailable/i,
    );
    expect(() => validateLineOutcome(ordered, { outcome: 'SHORT', qtyPicked: 4 })).toThrow(
      /picked in full/i,
    );
  });

  it('UNAVAILABLE means none, and restores everything', () => {
    expect(validateLineOutcome(ordered, { outcome: 'UNAVAILABLE', qtyPicked: 0 })).toMatchObject({
      lineStatus: 'UNAVAILABLE',
      qtyPicked: 0,
      restores: true,
      restoreBasis: 0,
    });
    expect(() => validateLineOutcome(ordered, { outcome: 'UNAVAILABLE', qtyPicked: 1 })).toThrow(
      /none/i,
    );
  });

  it('SUBSTITUTED names the substitute and how many of it went in, and restores the ordered product', () => {
    // None of the *ordered* product left the shelf, so all of it goes back —
    // `restoredQty` is what the restore counts, not the substitute's quantity.
    expect(
      validateLineOutcome(ordered, {
        outcome: 'SUBSTITUTED',
        qtyPicked: 4,
        substituteProductId: 'p-sub',
      }),
    ).toEqual({
      lineStatus: 'SUBSTITUTED',
      qtyPicked: 4,
      substituteProductId: 'p-sub',
      restores: true,
      restoreBasis: 0,
    });
    expect(() => validateLineOutcome(ordered, { outcome: 'SUBSTITUTED', qtyPicked: 4 })).toThrow(
      /substitute/i,
    );
    expect(() =>
      validateLineOutcome(ordered, {
        outcome: 'SUBSTITUTED',
        qtyPicked: 0,
        substituteProductId: 'p-sub',
      }),
    ).toThrow(/at least one/i);
  });

  it('refuses a quantity that is not a whole number, negative, or above the order', () => {
    expect(() => validateLineOutcome(ordered, { outcome: 'SHORT', qtyPicked: 1.5 })).toThrow(
      /whole number/i,
    );
    expect(() => validateLineOutcome(ordered, { outcome: 'SHORT', qtyPicked: -1 })).toThrow(
      /whole number/i,
    );
    expect(() => validateLineOutcome(ordered, { outcome: 'PICKED', qtyPicked: 5 })).toThrow(
      /more than/i,
    );
  });
});
