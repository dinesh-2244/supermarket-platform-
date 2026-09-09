/**
 * `orders` — public surface. Owns: Order, OrderLine, OrderStatusHistory, the state machine, admin correction.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  applyTransition,
  cancelByStore,
  confirmationDetails,
  confirmRevisedAmount,
  correctOrder,
  createOrder,
  liveOrdersInSlot,
  moduleDescriptor,
  orderForTracking,
  queueForStore,
  slotUsage,
  staffOrder,
  // `transition` is deliberately NOT exported: it is the in-transaction
  // primitive and authorizes nothing, so the only way to reach it from
  // outside this module is through `applyTransition`, which does (R1).
  type CancelResult,
  type ConfirmationDetails,
  type CreatedOrder,
  type NewOrderInput,
  type TimelineStep,
  type TrackedOrder,
  type TransitionOutcome,
} from './service';

export type { NewOrderLine, QueueRow, StaffOrderRow } from './repo';

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
