/**
 * The order lifecycle, as one table (architecture §11, phase-4-plan D1).
 *
 * Everything here is **pure**: no Prisma, no I/O, no framework types. The table
 * is the single source of truth for "may this order go from A to B", and
 * `service.transition()` is the only caller that turns a legal edge into writes.
 * Keeping the rule pure is what makes the 100 %-branch bar in the plan
 * achievable honestly — every edge, legal and illegal, is reachable from a unit
 * test with no database.
 *
 * There is deliberately **no customer-cancel edge** (R4). An order ends early
 * only through the audited store correction, `CANCELLED_BY_STORE`.
 */
import { ConflictError } from '../platform/index';

/** Every state in the lifecycle. Mirrors the `OrderStatus` enum in the schema. */
export type OrderStatus =
  | 'PLACED'
  | 'ACCEPTED'
  | 'PICKING'
  | 'PICKED'
  | 'BILLED_IN_POS'
  | 'PACKED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CLOSED'
  | 'CANCELLED_BY_STORE'
  | 'DELIVERY_FAILED'
  | 'CLOSED_UNDELIVERED';

export const ORDER_STATUSES: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PICKING',
  'PICKED',
  'BILLED_IN_POS',
  'PACKED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CLOSED',
  'CANCELLED_BY_STORE',
  'DELIVERY_FAILED',
  'CLOSED_UNDELIVERED',
];

/**
 * The timestamp column each arrival stamps, or `null` where the schema keeps
 * none. `CANCELLED_BY_STORE` stamps `correctedAt`, which is why the correction
 * is not a special case anywhere else.
 */
export type OrderTimestampField =
  | 'acceptedAt'
  | 'pickingStartedAt'
  | 'pickedAt'
  | 'billedAt'
  | 'packedAt'
  | 'dispatchedAt'
  | 'deliveredAt'
  | 'closedAt'
  | 'correctedAt';

/**
 * The domain event each arrival emits.
 *
 * Only the four the event bus already declares are real names; the rest of the
 * lifecycle is observable through `OrderStatusHistory` and gets no event until
 * something needs one. Inventing `order.picking`/`order.packed` now would put
 * names in the bus that no handler wants and that Phase 5 might contradict.
 */
export type OrderTransitionEvent =
  'order.picked' | 'order.billed' | 'order.delivered' | 'order.cancelled_by_store';

/** What the guard is allowed to look at. Read-only, and never the whole row. */
export interface TransitionContext {
  readonly priceVarianceFlagged: boolean;
  readonly customerConfirmedRevisedAmount: boolean;
}

export interface TransitionRule {
  readonly to: OrderStatus;
  /** Stamped on arrival, in the same update as the status change. */
  readonly stamps: OrderTimestampField | null;
  readonly emits: OrderTransitionEvent | null;
  /**
   * Extra condition beyond "this edge exists". Returns the refusal message, or
   * `null` to allow — a message rather than a boolean so the rejection can say
   * why without the caller re-deriving it.
   */
  readonly guard?: (context: TransitionContext) => string | null;
}

/**
 * `PACKED → OUT_FOR_DELIVERY` is the one edge with a business guard (R6): an
 * order whose POS total came in over tolerance must not go out of the door
 * until someone has confirmed the revised amount with the customer.
 */
function varianceGuard(context: TransitionContext): string | null {
  if (context.priceVarianceFlagged && !context.customerConfirmedRevisedAmount) {
    return 'The billed total is over tolerance — confirm the revised amount with the customer first';
  }
  return null;
}

/**
 * States an order can still be cancelled from. `OUT_FOR_DELIVERY` onwards it is
 * physically with a rider, so the correction is no longer the right instrument.
 */
const CANCELLABLE_FROM: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PICKING',
  'PICKED',
  'BILLED_IN_POS',
  'PACKED',
];

const CANCEL_RULE: TransitionRule = {
  to: 'CANCELLED_BY_STORE',
  stamps: 'correctedAt',
  emits: 'order.cancelled_by_store',
};

/**
 * `from → allowed[]`. A state absent from a row's list is not reachable from it,
 * and a terminal state has an empty list.
 */
export const TRANSITIONS: Readonly<Record<OrderStatus, readonly TransitionRule[]>> = {
  PLACED: [{ to: 'ACCEPTED', stamps: 'acceptedAt', emits: null }, CANCEL_RULE],
  ACCEPTED: [{ to: 'PICKING', stamps: 'pickingStartedAt', emits: null }, CANCEL_RULE],
  PICKING: [{ to: 'PICKED', stamps: 'pickedAt', emits: 'order.picked' }, CANCEL_RULE],
  PICKED: [{ to: 'BILLED_IN_POS', stamps: 'billedAt', emits: 'order.billed' }, CANCEL_RULE],
  BILLED_IN_POS: [{ to: 'PACKED', stamps: 'packedAt', emits: null }, CANCEL_RULE],
  PACKED: [
    {
      to: 'OUT_FOR_DELIVERY',
      stamps: 'dispatchedAt',
      emits: null,
      guard: varianceGuard,
    },
    CANCEL_RULE,
  ],
  OUT_FOR_DELIVERY: [
    { to: 'DELIVERED', stamps: 'deliveredAt', emits: 'order.delivered' },
    { to: 'DELIVERY_FAILED', stamps: null, emits: null },
  ],
  DELIVERED: [{ to: 'CLOSED', stamps: 'closedAt', emits: null }],
  DELIVERY_FAILED: [
    { to: 'OUT_FOR_DELIVERY', stamps: 'dispatchedAt', emits: null },
    { to: 'CLOSED_UNDELIVERED', stamps: 'closedAt', emits: null },
  ],
  CLOSED: [],
  CANCELLED_BY_STORE: [],
  CLOSED_UNDELIVERED: [],
};

export type TransitionCheck =
  | { readonly ok: true; readonly rule: TransitionRule }
  | { readonly ok: false; readonly reason: string };

/**
 * Is this edge legal, and does its guard pass?
 *
 * Returns rather than throws so callers that legitimately ask "could I?" — the
 * admin screen deciding which buttons to render — do not have to catch.
 */
export function checkTransition(
  from: OrderStatus,
  to: OrderStatus,
  context: TransitionContext,
): TransitionCheck {
  const rule = TRANSITIONS[from].find((candidate) => candidate.to === to);
  if (rule === undefined) {
    return { ok: false, reason: `An order cannot go from ${from} to ${to}` };
  }

  const refusal = rule.guard?.(context) ?? null;
  if (refusal !== null) {
    return { ok: false, reason: refusal };
  }

  return { ok: true, rule };
}

/** The throwing form, for the write path. An illegal edge writes nothing. */
export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  context: TransitionContext,
): TransitionRule {
  const check = checkTransition(from, to, context);
  if (!check.ok) {
    throw new ConflictError(check.reason, { from, to });
  }
  return check.rule;
}

/** Which states `cancelByStore` may be invoked from. */
export function canCancelByStore(from: OrderStatus): boolean {
  return CANCELLABLE_FROM.includes(from);
}

/**
 * After `BILLED_IN_POS` a bill exists in the POS that a cancellation cannot
 * retract, so the correction additionally requires a note describing the manual
 * void (D1).
 */
export function requiresDiscrepancyNote(from: OrderStatus): boolean {
  return from === 'BILLED_IN_POS' || from === 'PACKED';
}

export interface VarianceInput {
  readonly estimatedTotalPaise: number;
  readonly posFinalTotalPaise: number;
  readonly percentBp: number;
  readonly absCapPaise: number;
}

export interface VarianceResult {
  readonly overagePaise: number;
  readonly thresholdPaise: number;
  readonly flagged: boolean;
}

/**
 * How far over the estimate the POS came in, and whether that is over tolerance.
 *
 * The threshold is the **lower** of the percentage and the absolute cap (R6), so
 * a large basket cannot quietly drift by a large absolute amount. A POS total at
 * or below the estimate is never flagged — the shopper being charged less is not
 * a discrepancy anyone needs to confirm.
 */
export function computeVariance(input: VarianceInput): VarianceResult {
  const overagePaise = Math.max(0, input.posFinalTotalPaise - input.estimatedTotalPaise);
  const thresholdPaise = Math.min(
    Math.floor((input.estimatedTotalPaise * input.percentBp) / 10_000),
    input.absCapPaise,
  );
  return { overagePaise, thresholdPaise, flagged: overagePaise > thresholdPaise };
}
