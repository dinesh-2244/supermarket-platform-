/**
 * Pure domain logic for `inventory` — no I/O, no Prisma, no framework types.
 * Phase 1 ships the folder and the module descriptor only; the rules land with
 * the Phase 2 use-cases (docs/phase-0-architecture.md §4).
 */

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'inventory',
  owns: 'InventoryItem (websiteStock), StockLedger, CSV import, reconcile, POS-feed boundary',
  dependsOn: ['platform', 'catalog', 'stores'],
  emits: ['stock.low', 'stock.changed'],
};
