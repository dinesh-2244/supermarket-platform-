/**
 * Pure domain logic for `pricing` — no I/O, no Prisma, no framework types.
 */
import { ValidationError } from '../../platform/index';

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'pricing',
  owns: 'StoreProduct price fields, PriceChange',
  dependsOn: ['platform', 'catalog', 'stores'],
  emits: ['price.changed'],
};

export interface PriceInput {
  readonly mrpPaise: number;
  readonly sellingPricePaise: number;
}

/**
 * Prices are integer paise, both strictly positive, and selling price never
 * above MRP.
 *
 * The MRP rule is not a nicety: printing a selling price above the Maximum
 * Retail Price on the pack is illegal in India, and it is the sort of mistake a
 * fat-fingered decimal makes silently. A zero or negative price is refused for
 * the same reason — it would sail through a total calculation and only surface
 * as a customer paying nothing.
 */
export function assertPrice(input: PriceInput): void {
  for (const [field, value] of [
    ['mrpPaise', input.mrpPaise],
    ['sellingPricePaise', input.sellingPricePaise],
  ] as const) {
    if (!Number.isSafeInteger(value)) {
      throw new ValidationError(`${field} must be a whole number of paise`, { field, value });
    }
    if (value <= 0) {
      throw new ValidationError(`${field} must be greater than zero`, { field, value });
    }
  }

  if (input.sellingPricePaise > input.mrpPaise) {
    throw new ValidationError('Selling price cannot be above MRP', {
      mrpPaise: input.mrpPaise,
      sellingPricePaise: input.sellingPricePaise,
    });
  }
}

/** True when either price actually moved — no history row for a no-op edit. */
export function priceChanged(before: PriceInput, after: PriceInput): boolean {
  return before.mrpPaise !== after.mrpPaise || before.sellingPricePaise !== after.sellingPricePaise;
}

/** Discount in basis points, for the admin list. 0 when the price equals MRP. */
export function discountBp(input: PriceInput): number {
  if (input.mrpPaise <= 0) return 0;
  const off = input.mrpPaise - input.sellingPricePaise;
  return Math.round((off * 10_000) / input.mrpPaise);
}
