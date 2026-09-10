/**
 * `checkout` — public surface. Owns: serviceability check, store binding, placeOrder() (decrements stock in-tx).
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  availableSlots,
  moduleDescriptor,
  placeOrder,
  ShortfallError,
  type PlaceOrderInput,
  type PlacedOrder,
} from './service';

export {
  assertPaymentMethod,
  PAYMENT_METHODS,
  shortfallsIn,
  type LineShortfall,
  type ModuleDescriptor,
  type PaymentMethod,
} from './domain/index';
