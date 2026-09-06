/**
 * `stores` — public surface. Owns: Store, StoreSettings, DeliveryZone, DeliveryArea; resolveServiceability(input).
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export { moduleDescriptor } from './service';
export type { ModuleDescriptor } from './domain/index';
