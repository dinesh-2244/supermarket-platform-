/**
 * `fulfillment` — public surface. Owns: PickTask, PosBillingHandoff (+ variance calc), DeliveryRecord.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 *
 * Events (D7). Every status change here goes through `orders.transition`, so
 * the events are the order lifecycle's own, emitted after the transaction
 * commits, id-only:
 *   - `order.accepted`  { orderId } — `acceptOrder`
 *   - `order.picking`   { orderId } — `startPicking`
 *   - `order.picked`    { orderId } — `completePicking`
 *   - `order.billed`    { orderId, priceVarianceFlagged } — `recordFinalBill`
 * Recording a line emits nothing; its trail is the `StockLedger` row (for a
 * restore) and the `AuditLog` row on the line.
 */
export {
  acceptOrder,
  billingDetails,
  billingQueue,
  completePicking,
  confirmRevisedAmount,
  moduleDescriptor,
  pickLines,
  pickingQueue,
  recordFinalBill,
  recordLinePick,
  startPicking,
  type BilledOrder,
  type FinalBillFormInput,
  type PickingQueueRow,
  type PickTaskRow,
  type PickTaskStatus,
  type PosBillingHandoffRow,
} from './service';

// The ADR-0007 boundary, for contract tests and a future adapter — not for
// pages, which record a bill through `recordFinalBill`.
export {
  ManualPosBillingGateway,
  posBillingGatewayFor,
  type FinalBill,
  type FinalBillInput,
  type PosBillingGateway,
  type PosMode,
} from './pos/pos-billing-gateway';

export {
  restoreQuantity,
  validateLineOutcome,
  type LineOutcome,
  type LinePickInput,
  type ModuleDescriptor,
  type PickOutcome,
} from './domain/index';
