/**
 * `notifications` — public surface. Owns: provider interface plus SMS/email/no-op implementations, outbound log.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  currentProvider,
  moduleDescriptor,
  registerOrderNotifications,
  resetProvider,
  sendOrderConfirmation,
  setProviderForTests,
  type OrderConfirmationInput,
} from './service';

export {
  orderConfirmationMessage,
  type ModuleDescriptor,
  type NotificationChannel,
  type NotificationProvider,
  type OutboundMessage,
} from './domain/index';

export { noopProvider } from './providers/noop';
