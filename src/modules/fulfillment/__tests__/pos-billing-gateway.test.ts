import { describe, expect, it } from 'vitest';
import {
  ManualPosBillingGateway,
  posBillingGatewayFor,
  type FinalBill,
  type PosBillingGateway,
} from '../pos/pos-billing-gateway';

/**
 * The ADR-0007 boundary: where a final bill comes from. V1 has one real
 * implementation — a staff member typing the POS bill in — and this suite is
 * the *contract* every implementation must meet, so a future adapter passes
 * the same tests before it can be wired.
 */
class FakeGateway implements PosBillingGateway {
  readonly mode = 'MANUAL' as const;
  recordFinalBill(
    orderId: string,
    input: {
      billNumber: string;
      finalTotalPaise: number;
      billedByUserId: string;
      discrepancyNote?: string | null;
    },
  ): Promise<FinalBill> {
    const note = (input.discrepancyNote ?? '').trim();
    return Promise.resolve({
      orderId,
      billNumber: input.billNumber.trim(),
      finalTotalPaise: input.finalTotalPaise,
      billedByUserId: input.billedByUserId,
      discrepancyNote: note.length === 0 ? null : note,
    });
  }
}

describe.each([
  ['ManualPosBillingGateway', () => new ManualPosBillingGateway()],
  ['a fake', () => new FakeGateway()],
])('PosBillingGateway contract — %s', (_name, make) => {
  it('returns the bill it was given, trimmed, keyed to the order', async () => {
    const bill = await make().recordFinalBill('o1', {
      billNumber: ' POS-0042 ',
      finalTotalPaise: 12_345,
      billedByUserId: 'u1',
      discrepancyNote: '  ',
    });
    expect(bill).toEqual({
      orderId: 'o1',
      billNumber: 'POS-0042',
      finalTotalPaise: 12_345,
      billedByUserId: 'u1',
      discrepancyNote: null,
    });
  });

  it('keeps a discrepancy note when there is one', async () => {
    const bill = await make().recordFinalBill('o1', {
      billNumber: 'POS-1',
      finalTotalPaise: 1,
      billedByUserId: 'u1',
      discrepancyNote: ' one item voided ',
    });
    expect(bill.discrepancyNote).toBe('one item voided');
  });
});

describe('ManualPosBillingGateway — what a typed-in bill must look like', () => {
  const gateway = new ManualPosBillingGateway();
  const ok = { billNumber: 'POS-1', finalTotalPaise: 1_000, billedByUserId: 'u1' };

  it('refuses a blank bill number', async () => {
    await expect(gateway.recordFinalBill('o1', { ...ok, billNumber: '   ' })).rejects.toThrow(
      /bill number/i,
    );
  });

  it('refuses a total that is not a whole non-negative number of paise', async () => {
    await expect(gateway.recordFinalBill('o1', { ...ok, finalTotalPaise: 10.5 })).rejects.toThrow(
      /whole/i,
    );
    await expect(gateway.recordFinalBill('o1', { ...ok, finalTotalPaise: -1 })).rejects.toThrow(
      /whole/i,
    );
    await expect(
      gateway.recordFinalBill('o1', { ...ok, finalTotalPaise: 0 }),
    ).resolves.toMatchObject({
      finalTotalPaise: 0,
    });
  });

  it('caps the bill number and the note so a form cannot be used as free storage', async () => {
    await expect(
      gateway.recordFinalBill('o1', { ...ok, billNumber: 'x'.repeat(65) }),
    ).rejects.toThrow(/too long/i);
    await expect(
      gateway.recordFinalBill('o1', { ...ok, discrepancyNote: 'n'.repeat(501) }),
    ).rejects.toThrow(/too long/i);
  });
});

describe('posBillingGatewayFor — the mode selector', () => {
  it('gives the manual gateway for MANUAL', () => {
    expect(posBillingGatewayFor('MANUAL')).toBeInstanceOf(ManualPosBillingGateway);
  });

  it('refuses ADAPTER: no vendor is integrated (ADR-0007)', () => {
    expect(() => posBillingGatewayFor('ADAPTER')).toThrow(/no POS vendor/i);
  });
});
