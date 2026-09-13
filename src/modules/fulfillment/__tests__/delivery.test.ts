import { describe, expect, it } from 'vitest';
import { requireReason, validatePaymentCapture } from '../domain/index';

describe('validatePaymentCapture — what a delivery payment must look like', () => {
  it('cash: a whole non-negative amount, no reference', () => {
    expect(validatePaymentCapture({ paymentMethodUsed: 'CASH', amountCollectedPaise: 0 })).toEqual({
      paymentMethodUsed: 'CASH',
      amountCollectedPaise: 0,
      upiRef: null,
    });
    expect(() =>
      validatePaymentCapture({ paymentMethodUsed: 'CASH', amountCollectedPaise: 1, upiRef: 'x' }),
    ).toThrow(/cash/i);
  });

  it('UPI: the reference is required, trimmed and bounded', () => {
    expect(
      validatePaymentCapture({ paymentMethodUsed: 'UPI', amountCollectedPaise: 5, upiRef: ' r1 ' }),
    ).toEqual({ paymentMethodUsed: 'UPI', amountCollectedPaise: 5, upiRef: 'r1' });
    expect(() =>
      validatePaymentCapture({ paymentMethodUsed: 'UPI', amountCollectedPaise: 5, upiRef: '  ' }),
    ).toThrow(/UPI reference/i);
    expect(() =>
      validatePaymentCapture({
        paymentMethodUsed: 'UPI',
        amountCollectedPaise: 5,
        upiRef: 'r'.repeat(65),
      }),
    ).toThrow(/too long/i);
  });

  it('refuses a fractional or negative amount', () => {
    expect(() =>
      validatePaymentCapture({ paymentMethodUsed: 'CASH', amountCollectedPaise: 1.5 }),
    ).toThrow(/whole/i);
    expect(() =>
      validatePaymentCapture({ paymentMethodUsed: 'CASH', amountCollectedPaise: -1 }),
    ).toThrow(/whole/i);
  });
});

describe('requireReason', () => {
  it('trims, and refuses blank or over-long reasons', () => {
    expect(requireReason('  gone away ', 'X')).toBe('gone away');
    expect(() => requireReason('', 'Closing')).toThrow(/Closing needs a reason/);
    expect(() => requireReason(null, 'Closing')).toThrow(/reason/);
    expect(() => requireReason('r'.repeat(501), 'Closing')).toThrow(/too long/i);
  });
});
