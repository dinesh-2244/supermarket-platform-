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
 * The domain event each arrival emits — **one per legal edge**, never `null`.
 *
 * The first version emitted only the four names the bus already declared and
 * left the rest of the lifecycle observable through `OrderStatusHistory` alone.
 * That was an omission, not a design (OSCAR R7): D1/D7 ask for a transition
 * event on every edge, and "the bus does not name it yet" is an argument for
 * naming it rather than for staying quiet. A subscriber that does not care about
 * `order.picking` simply does not subscribe; one that does had no way to hear it.
 */
export type OrderTransitionEvent =
  | 'order.accepted'
  | 'order.picking'
  | 'order.picked'
  | 'order.billed'
  | 'order.packed'
  | 'order.dispatched'
  | 'order.delivered'
  | 'order.closed'
  | 'order.delivery_failed'
  | 'order.closed_undelivered'
  | 'order.cancelled_by_store';

/** What the guard is allowed to look at. Read-only, and never the whole row. */
export interface TransitionContext {
  readonly priceVarianceFlagged: boolean;
  readonly customerConfirmedRevisedAmount: boolean;
}

export interface TransitionRule {
  readonly to: OrderStatus;
  /** Stamped on arrival, in the same update as the status change. */
  readonly stamps: OrderTimestampField | null;
  /** Every edge announces itself. Never `null` — see {@link OrderTransitionEvent}. */
  readonly emits: OrderTransitionEvent;
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
  PLACED: [{ to: 'ACCEPTED', stamps: 'acceptedAt', emits: 'order.accepted' }, CANCEL_RULE],
  ACCEPTED: [{ to: 'PICKING', stamps: 'pickingStartedAt', emits: 'order.picking' }, CANCEL_RULE],
  PICKING: [{ to: 'PICKED', stamps: 'pickedAt', emits: 'order.picked' }, CANCEL_RULE],
  PICKED: [{ to: 'BILLED_IN_POS', stamps: 'billedAt', emits: 'order.billed' }, CANCEL_RULE],
  BILLED_IN_POS: [{ to: 'PACKED', stamps: 'packedAt', emits: 'order.packed' }, CANCEL_RULE],
  PACKED: [
    {
      to: 'OUT_FOR_DELIVERY',
      stamps: 'dispatchedAt',
      emits: 'order.dispatched',
      guard: varianceGuard,
    },
    CANCEL_RULE,
  ],
  OUT_FOR_DELIVERY: [
    { to: 'DELIVERED', stamps: 'deliveredAt', emits: 'order.delivered' },
    { to: 'DELIVERY_FAILED', stamps: null, emits: 'order.delivery_failed' },
  ],
  DELIVERED: [{ to: 'CLOSED', stamps: 'closedAt', emits: 'order.closed' }],
  DELIVERY_FAILED: [
    { to: 'OUT_FOR_DELIVERY', stamps: 'dispatchedAt', emits: 'order.dispatched' },
    { to: 'CLOSED_UNDELIVERED', stamps: 'closedAt', emits: 'order.closed_undelivered' },
  ],
  CLOSED: [],
  CANCELLED_BY_STORE: [],
  CLOSED_UNDELIVERED: [],
};

/**
 * A rule that has been through {@link assertTransition}.
 *
 * The brand is a module-private symbol, so no code outside this file can
 * construct one — not even by writing an object literal with the right shape.
 * `repo.setStatus` demands one, which is what makes "the state machine is the
 * only way an `Order.status` moves" a *compile-time* property rather than a
 * convention a source scan hopes to notice (OSCAR R8).
 *
 * The previous guard checked that the caller lived in `service.ts`. A second
 * function in that same file calling `repo.setStatus(tx, id, 'CANCELLED_BY_STORE',
 * null, new Date())` passed every one of those checks while skipping the edge
 * validation and the history row. It no longer compiles.
 */
declare const validatedEdge: unique symbol;
export type ValidatedTransition = TransitionRule & { readonly [validatedEdge]: true };

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
): ValidatedTransition {
  const check = checkTransition(from, to, context);
  if (!check.ok) {
    throw new ConflictError(check.reason, { from, to });
  }
  // The only place a `ValidatedTransition` is ever minted, and it is minted
  // *after* the edge and its guard have both been checked.
  return check.rule as ValidatedTransition;
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
