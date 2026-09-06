/**
 * `inventory` — public surface. Owns: InventoryItem (websiteStock), StockLedger, CSV import, reconcile, POS-feed boundary.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export { moduleDescriptor } from './service.js';
export type { ModuleDescriptor } from './domain/index.js';
