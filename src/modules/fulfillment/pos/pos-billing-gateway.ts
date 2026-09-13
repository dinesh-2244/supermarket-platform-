/**
 * The POS billing boundary (ADR-0007).
 *
 * "Where does the final bill come from?" is the only question a POS answers
 * for this platform, and this interface is the whole of the answer's shape.
 * V1 has exactly one implementation: a member of staff types the POS bill in.
 * A vendor adapter — which would fetch the bill instead — does not exist, is
 * not stubbed, and is not selected anywhere; `posBillingGatewayFor('ADAPTER')`
 * refuses until a vendor is chosen and ADR-0007's four preconditions are met.
 *
 * The gateway *produces* a bill; persisting it (the `PosBillingHandoff` row,
 * the order's POS fields, the variance flag, the transition) is the service's
 * job, so a future adapter changes nothing downstream of this line.
 */
import { ConflictError, ValidationError } from '../../platform/index';

export type PosMode = 'MANUAL' | 'ADAPTER';

export interface FinalBillInput {
  readonly billNumber: string;
  readonly finalTotalPaise: number;
  readonly billedByUserId: string;
  readonly discrepancyNote?: string | null;
}

/** A bill as the platform records it, whatever produced it. */
export interface FinalBill {
  readonly orderId: string;
  readonly billNumber: string;
  readonly finalTotalPaise: number;
  readonly billedByUserId: string;
  readonly discrepancyNote: string | null;
}

export interface PosBillingGateway {
  readonly mode: PosMode;
  recordFinalBill(orderId: string, input: FinalBillInput): Promise<FinalBill>;
}

const BILL_NUMBER_MAX = 64;
const NOTE_MAX = 500;

/**
 * V1: the bill is whatever the staff member typed, checked for shape only —
 * the POS printed it, and this platform has no way to know better.
 */
export class ManualPosBillingGateway implements PosBillingGateway {
  readonly mode = 'MANUAL' as const;

  recordFinalBill(orderId: string, input: FinalBillInput): Promise<FinalBill> {
    // Synchronous in substance — the bill is already in hand — but the
    // interface is asynchronous because an adapter's would not be.
    return new Promise((resolve) => {
      resolve(this.check(orderId, input));
    });
  }

  private check(orderId: string, input: FinalBillInput): FinalBill {
    const billNumber = input.billNumber.trim();
    if (billNumber.length === 0) {
      throw new ValidationError('Enter the POS bill number', { field: 'billNumber' });
    }
    if (billNumber.length > BILL_NUMBER_MAX) {
      throw new ValidationError('That bill number is too long', { field: 'billNumber' });
    }
    if (!Number.isInteger(input.finalTotalPaise) || input.finalTotalPaise < 0) {
      throw new ValidationError('The final total must be a whole number of paise, zero or more', {
        field: 'finalTotalPaise',
      });
    }
    const note = (input.discrepancyNote ?? '').trim();
    if (note.length > NOTE_MAX) {
      throw new ValidationError('That note is too long', { field: 'discrepancyNote' });
    }
    return {
      orderId,
      billNumber,
      finalTotalPaise: input.finalTotalPaise,
      billedByUserId: input.billedByUserId,
      discrepancyNote: note.length === 0 ? null : note,
    };
  }
}

/**
 * The implementation for a store's `posMode`. `MANUAL` is the permanent
 * baseline; `ADAPTER` is refused rather than stubbed, so no code path can
 * quietly start assuming a vendor that has not been chosen.
 */
export function posBillingGatewayFor(mode: PosMode): PosBillingGateway {
  switch (mode) {
    case 'MANUAL':
      return new ManualPosBillingGateway();
    case 'ADAPTER':
      throw new ConflictError(
        'This store is set to POS adapter mode, but no POS vendor is integrated (ADR-0007) — bill manually',
        { posMode: mode },
      );
  }
}
