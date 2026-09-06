/**
 * `identity` — public surface. Owns: User, RBAC, staff authentication.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export { moduleDescriptor } from './service.js';
export type { ModuleDescriptor } from './domain/index.js';
