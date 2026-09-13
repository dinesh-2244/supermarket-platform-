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
 * Recording a line emits nothing; its trail is the `StockLedger` row (for a
 * restore) and the `AuditLog` row on the line.
 */
export {
  acceptOrder,
  completePicking,
  moduleDescriptor,
  pickLines,
  pickingQueue,
  recordLinePick,
  startPicking,
  type PickingQueueRow,
  type PickTaskRow,
  type PickTaskStatus,
} from './service';

export {
  restoreQuantity,
  validateLineOutcome,
  type LineOutcome,
  type LinePickInput,
  type ModuleDescriptor,
  type PickOutcome,
} from './domain/index';
