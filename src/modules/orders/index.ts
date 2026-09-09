/**
 * `orders` — public surface. Owns: Order, OrderLine, OrderStatusHistory, the state machine, admin correction.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  applyTransition,
  cancelByStore,
  correctOrder,
  createOrder,
  moduleDescriptor,
  transition,
  type CancelResult,
  type CreatedOrder,
  type NewOrderInput,
  type TransitionOutcome,
} from './service';

export type { NewOrderLine } from './repo';

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
