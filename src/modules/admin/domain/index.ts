/**
 * Pure domain logic for `admin` — no I/O, no Prisma, no framework types.
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
  name: 'admin',
  owns: 'read-models / BFF for the admin UI (no domain rules)',
  dependsOn: [
    'platform',
    'stores',
    'catalog',
    'pricing',
    'inventory',
    'identity',
    'customers',
    'orders',
    'fulfillment',
  ],
  emits: [],
};
