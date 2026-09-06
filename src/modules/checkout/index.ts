/**
 * `checkout` — public surface. Owns: serviceability check, store binding, placeOrder() (decrements stock in-tx).
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export { moduleDescriptor } from './service';
export type { ModuleDescriptor } from './domain/index';
