/**
 * Pure domain logic for `fulfillment` — no I/O, no Prisma, no framework types.
 *
 * Phase 5 walks an order through the lifecycle Phase 4 built. The rules here
 * are the ones that are *not* the state machine's: what each pick outcome must
 * look like, and — the one with real stock at stake — how much a short or
 * unavailable line gives back to the shelf.
 */
import { ValidationError } from '../../platform/index';

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'fulfillment',
  owns: 'PickTask, PosBillingHandoff (+ variance calc), DeliveryRecord',
  dependsOn: ['platform', 'orders', 'inventory', 'pricing', 'notifications'],
  emits: ['order.picked', 'order.billed', 'order.delivered'],
};

export type PickOutcome = 'PICKED' | 'SHORT' | 'SUBSTITUTED' | 'UNAVAILABLE';

export interface LinePickInput {
  readonly outcome: PickOutcome;
  /** Units that went into the basket — of the substitute, when there is one. */
  readonly qtyPicked: number;
  readonly substituteProductId?: string | null;
  readonly note?: string | null;
}

export interface LineOutcome {
  readonly lineStatus: PickOutcome;
  readonly qtyPicked: number;
  readonly substituteProductId: string | null;
  /** Whether the unpicked remainder goes back to website stock. */
  readonly restores: boolean;
  /**
   * How many units of the **ordered** product went into the basket — what the
   * restore is measured against. Equal to `qtyPicked` except for a
   * substitution, where `qtyPicked` counts the substitute and none of the
   * ordered product left the shelf.
   */
  readonly restoreBasis: number;
}

/**
 * How many units a short or unavailable line gives back to `websiteStock`.
 *
 * `qtyOrdered − qtyPicked − stockRestoredQty`, floored at zero: what was
 * ordered, less what actually went into the basket, less whatever an earlier
 * restore already returned. The same counter `cancelByStore` reads, so a
 * later correction restores only what picking has not — never the same unit
 * twice (R11).
 */
export function restoreQuantity(line: {
  readonly qtyOrdered: number;
  readonly qtyPicked: number;
  readonly stockRestoredQty: number;
}): number {
  return Math.max(0, line.qtyOrdered - line.qtyPicked - line.stockRestoredQty);
}

/**
 * Check a pick outcome against the line, or throw.
 *
 * - `PICKED` — the whole quantity, no substitute.
 * - `SHORT` — some but not all; the rest is restored.
 * - `UNAVAILABLE` — none; all of it is restored.
 * - `SUBSTITUTED` — a named substitute, at least one of it. The **ordered**
 *   product is restored in full, exactly as if it were unavailable: none of it
 *   left the shelf, and leaving its `websiteStock` understated would hide real
 *   stock from future orders (decision 2026-09-13). The substitute's own
 *   decrement is a different stock path — crediting a product for an order it
 *   was not ordered on — and is deliberately not part of this phase.
 */
export function validateLineOutcome(qtyOrdered: number, input: LinePickInput): LineOutcome {
  const qty = input.qtyPicked;
  if (!Number.isInteger(qty) || qty < 0) {
    throw new ValidationError('The picked quantity must be a whole number of units', {
      qtyPicked: qty,
    });
  }
  if (qty > qtyOrdered) {
    throw new ValidationError('More than the ordered quantity was picked', {
      qtyPicked: qty,
      qtyOrdered,
    });
  }
  const substitute = (input.substituteProductId ?? '').trim();

  switch (input.outcome) {
    case 'PICKED':
      if (substitute.length > 0) {
        throw new ValidationError('A full pick has no substitute — record it as SUBSTITUTED', {});
      }
      if (qty !== qtyOrdered) {
        throw new ValidationError(
          'A full pick is the whole quantity — record fewer as a short pick',
          {
            qtyPicked: qty,
            qtyOrdered,
          },
        );
      }
      return {
        lineStatus: 'PICKED',
        qtyPicked: qty,
        substituteProductId: null,
        restores: false,
        restoreBasis: qty,
      };
    case 'SHORT':
      if (qty === 0) {
        throw new ValidationError('Nothing picked is an unavailable line, not a short one', {});
      }
      if (qty === qtyOrdered) {
        throw new ValidationError(
          'The whole quantity was picked in full — record it as PICKED',
          {},
        );
      }
      return {
        lineStatus: 'SHORT',
        qtyPicked: qty,
        substituteProductId: null,
        restores: true,
        restoreBasis: qty,
      };
    case 'UNAVAILABLE':
      if (qty !== 0) {
        throw new ValidationError('An unavailable line has none picked', { qtyPicked: qty });
      }
      return {
        lineStatus: 'UNAVAILABLE',
        qtyPicked: 0,
        substituteProductId: null,
        restores: true,
        restoreBasis: 0,
      };
    case 'SUBSTITUTED':
      if (substitute.length === 0) {
        throw new ValidationError('A substitution names the substitute product', {});
      }
      if (qty === 0) {
        throw new ValidationError('A substitution puts at least one unit of the substitute in', {});
      }
      return {
        lineStatus: 'SUBSTITUTED',
        qtyPicked: qty,
        substituteProductId: substitute,
        restores: true,
        restoreBasis: 0,
      };
  }
}
