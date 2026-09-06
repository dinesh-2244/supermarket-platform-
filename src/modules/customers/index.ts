/**
 * `customers` — public surface. Owns: Customer, CustomerAddress, OtpChallenge (disabled), optional accounts.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export { moduleDescriptor } from './service.js';
export type { ModuleDescriptor } from './domain/index.js';
