import { describe, expect, it } from 'vitest';
import { requireReason, validatePaymentCapture } from '../domain/index';

describe('validatePaymentCapture — what a delivery payment must look like', () => {
  it('cash: the POS total exactly, no reference', () => {
    expect(
      validatePaymentCapture({ paymentMethodUsed: 'CASH', amountCollectedPaise: 250 }, 250),
    ).toEqual({ paymentMethodUsed: 'CASH', amountCollectedPaise: 250, upiRef: null });
    expect(() =>
      validatePaymentCapture(
        { paymentMethodUsed: 'CASH', amountCollectedPaise: 250, upiRef: 'x' },
        250,
      ),
    ).toThrow(/cash/i);
  });

  it('UPI: the reference is required, trimmed and bounded', () => {
    expect(
      validatePaymentCapture(
        { paymentMethodUsed: 'UPI', amountCollectedPaise: 5, upiRef: ' r1 ' },
        5,
      ),
    ).toEqual({ paymentMethodUsed: 'UPI', amountCollectedPaise: 5, upiRef: 'r1' });
    expect(() =>
      validatePaymentCapture(
        { paymentMethodUsed: 'UPI', amountCollectedPaise: 5, upiRef: '  ' },
        5,
      ),
    ).toThrow(/UPI reference/i);
    expect(() =>
      validatePaymentCapture(
        { paymentMethodUsed: 'UPI', amountCollectedPaise: 5, upiRef: 'r'.repeat(65) },
        5,
      ),
    ).toThrow(/too long/i);
  });

  it('refuses a fractional or negative amount', () => {
    expect(() =>
      validatePaymentCapture({ paymentMethodUsed: 'CASH', amountCollectedPaise: 1.5 }, 1),
    ).toThrow(/whole/i);
    expect(() =>
      validatePaymentCapture({ paymentMethodUsed: 'CASH', amountCollectedPaise: -1 }, 1),
    ).toThrow(/whole/i);
  });

  it('refuses anything but the POS total: nothing, less, more (OSCAR H1 on PR #54)', () => {
    // A delivery with the wrong amount is not a delivery — there is no
    // balance-due or refund path in this phase, so the mismatch stops here.
    for (const amount of [0, 249, 251]) {
      expect(() =>
        validatePaymentCapture({ paymentMethodUsed: 'CASH', amountCollectedPaise: amount }, 250),
      ).toThrow(/POS bill/i);
      expect(() =>
        validatePaymentCapture(
          { paymentMethodUsed: 'UPI', amountCollectedPaise: amount, upiRef: 'r1' },
          250,
        ),
      ).toThrow(/POS bill/i);
    }
    // A zero bill (everything unavailable, fee waived) collects zero.
    expect(
      validatePaymentCapture({ paymentMethodUsed: 'CASH', amountCollectedPaise: 0 }, 0),
    ).toMatchObject({ amountCollectedPaise: 0 });
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
