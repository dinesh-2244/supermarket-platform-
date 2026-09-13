/**
 * `orders` — public surface. Owns: Order, OrderLine, OrderStatusHistory, the state machine, admin correction.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  announceTransition,
  applyTransition,
  cancelByStore,
  confirmationDetails,
  confirmRevisedAmount,
  correctOrder,
  createOrder,
  liveOrdersInSlot,
  moduleDescriptor,
  orderCountsForStore,
  orderForTracking,
  ordersForCustomer,
  queueForStore,
  slotUsage,
  staffOrder,
  // `transition` is the in-transaction primitive and **authorizes nothing**.
  // It was withheld from this surface until Phase 5 (R1); `fulfillment` now
  // drives the lifecycle from inside its own transactions and must authorize
  // against the locked order's store *before* calling it, exactly as
  // `applyTransition` does. `app/` never calls it — the boundary lint keeps
  // pages on the public wrappers.
  transition,
  type CancelResult,
  type ConfirmationDetails,
  type CreatedOrder,
  type CustomerOrderSummary,
  type NewOrderInput,
  type OrderCounts,
  type TimelineStep,
  type TrackedOrder,
  type TransitionOutcome,
} from './service';

export type { NewOrderLine, QueueRow, StaffOrderRow } from './repo';

// The order/line rows `fulfillment` works on. `orders` owns `Order` and
// `OrderLine`; these are the only writes to them a peer may make, and every
// one takes a `Tx`.
export {
  addStockRestored,
  listPickLines,
  lockOrder,
  lockPickLine,
  setLineOutcome,
  type LockedOrderRow,
  type OrderLineStatus,
  type PickLineRow,
} from './repo';

export {
  assertTransition,
  canCancelByStore,
  checkTransition,
  computeVariance,
  ORDER_STATUSES,
  requiresDiscrepancyNote,
  TRANSITIONS,
  type OrderStatus,
  type OrderTimestampField,
  type OrderTransitionEvent,
  type TransitionCheck,
  type TransitionContext,
  type TransitionRule,
  type VarianceInput,
  type VarianceResult,
} from './state-machine';

export type { ModuleDescriptor } from './domain/index';
