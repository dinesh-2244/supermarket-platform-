/**
 * `checkout` — public surface. Owns: serviceability check, store binding, placeOrder() (decrements stock in-tx).
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  moduleDescriptor,
  placeOrder,
  ShortfallError,
  type PlaceOrderInput,
  type PlacedOrder,
} from './service';

export {
  assertPaymentMethod,
  assertSlotShape,
  isOnSlotGrid,
  PAYMENT_METHODS,
  shortfallsIn,
  slotEnd,
  type LineShortfall,
  type ModuleDescriptor,
  type PaymentMethod,
  type SlotShapeInput,
} from './domain/index';
