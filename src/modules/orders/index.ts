/**
 * `orders` — public surface. Owns: Order, OrderLine, OrderStatusHistory, the state machine, admin correction.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export { moduleDescriptor } from './service.js';
export type { ModuleDescriptor } from './domain/index.js';
