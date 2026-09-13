export type CategoryGroup =
  'vegetables' | 'dairy' | 'staples' | 'beverages' | 'household' | 'general';

/**
 * Resolves a product to its canonical high-level category group matching
 * the platform's category taxonomy.
 */
export function resolveCategoryGroup(options: {
  categorySlug?: string | null | undefined;
  productSlug?: string | null | undefined;
  name?: string | null | undefined;
}): CategoryGroup {
  const { categorySlug, productSlug, name } = options;

  if (categorySlug) {
    const slug = categorySlug.toLowerCase();
    if (slug.includes('fruit') || slug.includes('veg') || slug.includes('produce')) {
      return 'vegetables';
    }
    if (slug.includes('dairy') || slug.includes('bakery') || slug.includes('milk')) {
      return 'dairy';
    }
    if (
      slug.includes('staple') ||
      slug.includes('grain') ||
      slug.includes('pulse') ||
      slug.includes('flour') ||
      slug.includes('rice') ||
      slug.includes('oil')
    ) {
      return 'staples';
    }
    if (
      slug.includes('snack') ||
      slug.includes('bev') ||
      slug.includes('drink') ||
      slug.includes('tea') ||
      slug.includes('coffee')
    ) {
      return 'beverages';
    }
    if (slug.includes('house') || slug.includes('clean') || slug.includes('home')) {
      return 'household';
    }
  }

  // Infer from product slug or name if categorySlug was not specified or matched
  const candidate = `${productSlug ?? ''} ${name ?? ''}`.toLowerCase();
  if (
    /\b(banana|apple|mango|potato|tomato|onion|carrot|lemon|spinach|vegetable|fruit|greens|produce)\b/.test(
      candidate,
    )
  ) {
    return 'vegetables';
  }
  if (/\b(milk|curd|paneer|butter|cheese|ghee|yogurt|bread|bun|bakery|toast)\b/.test(candidate)) {
    return 'dairy';
  }
  if (
    /\b(rice|dal|flour|atta|maida|salt|sugar|oil|spice|grain|wheat|ragi|pulse|staple|sunflower)\b/.test(
      candidate,
    )
  ) {
    return 'staples';
  }
  if (
    /\b(tea|coffee|biscuit|cookie|chips|snack|namkeen|juice|beverage|drink|soda|peanuts)\b/.test(
      candidate,
    )
  ) {
    return 'beverages';
  }
  if (
    /\b(detergent|dishwash|soap|cleaner|surf|shampoo|sponge|tissue|household)\b/.test(candidate)
  ) {
    return 'household';
  }

  return 'general';
}
