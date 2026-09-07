/**
 * Pure domain logic for `catalog` — no I/O, no Prisma, no framework types.
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
  name: 'catalog',
  owns: 'Category, Product, ProductImage',
  dependsOn: ['platform'],
  emits: ['product.updated'],
};
