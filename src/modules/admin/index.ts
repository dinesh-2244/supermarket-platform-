/**
 * `admin` — public surface. Owns: read-models / BFF for the admin UI (no domain rules).
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export { moduleDescriptor } from './service';
export type { ModuleDescriptor } from './domain/index';
