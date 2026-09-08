/**
 * Pure domain logic for `catalog` — no I/O, no Prisma, no framework types.
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
  name: 'catalog',
  owns: 'Category, Product, ProductImage',
  dependsOn: ['platform'],
  emits: ['product.updated'],
};

/**
 * URL-safe slug. Generated from a name when none is given, but always validated:
 * `slug` is unique at the database level and ends up in customer-facing URLs, so
 * it cannot carry whitespace or punctuation that would have to be escaped.
 */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug === '') throw new ValidationError('Cannot build a slug from that name', { value });
  return slug;
}

export function assertSlug(slug: string): string {
  const trimmed = slug.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(trimmed)) {
    throw new ValidationError('A slug is lower-case letters, digits and single hyphens', { slug });
  }
  return trimmed;
}

/**
 * A SKU is the identity of a real product — a barcode where one exists. Stored
 * upper-cased so `abc123` and `ABC123` cannot become two master rows for one
 * physical item, which is the duplication ADR-0003 forbids.
 */
export function assertSku(sku: string): string {
  const trimmed = sku.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,31}$/.test(trimmed)) {
    throw new ValidationError('A SKU is 2–32 characters of A–Z, 0–9, dot, underscore or hyphen', {
      sku,
    });
  }
  return trimmed;
}

export function assertRequiredName(name: string, field = 'Name'): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new ValidationError(`${field} is required`, {});
  if (trimmed.length > 200) throw new ValidationError(`${field} is too long`, { field });
  return trimmed;
}

/**
 * Product images are referenced by URL only — object-storage upload wiring is
 * explicitly out of scope this phase. Restricting the scheme is still worth it:
 * a `javascript:` or `data:` URL rendered into an `<img src>` on the storefront
 * is a stored-XSS vector, and this is the one place it can be refused.
 */
export function assertImageUrl(url: string): string {
  const trimmed = url.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError('Enter a complete image URL', { url });
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new ValidationError('An image URL must be http(s)', { url });
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Category tree
// ---------------------------------------------------------------------------

export interface CategoryNode {
  readonly id: string;
  readonly parentId: string | null;
}

/**
 * Refuse a parent change that would close a loop.
 *
 * A cycle in the tree is not a cosmetic problem: every walk of the tree — a
 * breadcrumb, a "all products under this category" query, the admin tree editor
 * — becomes an infinite loop. Cheaper to refuse the edge than to defend every
 * traversal.
 *
 * Walks *up* from the proposed parent: if the category being moved is already an
 * ancestor of its new parent, the move would make it its own ancestor.
 */
export function assertNoCycle(
  categoryId: string,
  proposedParentId: string | null,
  all: readonly CategoryNode[],
): void {
  if (proposedParentId === null) return;
  if (proposedParentId === categoryId) {
    throw new ValidationError('A category cannot be its own parent', { categoryId });
  }

  const parentOf = new Map(all.map((node) => [node.id, node.parentId]));
  if (!parentOf.has(proposedParentId)) {
    throw new ValidationError('The parent category does not exist', { proposedParentId });
  }

  const seen = new Set<string>();
  let cursor: string | null = proposedParentId;
  while (cursor !== null) {
    if (cursor === categoryId) {
      throw new ValidationError('That parent is below this category in the tree', {
        categoryId,
        proposedParentId,
      });
    }
    // Defensive: existing data could already be looped; do not hang on it.
    if (seen.has(cursor)) {
      throw new ValidationError('The category tree already contains a cycle', { cursor });
    }
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
}

/** Depth of a category, for the admin tree editor's indentation. */
export function depthOf(categoryId: string, all: readonly CategoryNode[]): number {
  const parentOf = new Map(all.map((node) => [node.id, node.parentId]));
  let depth = 0;
  let cursor = parentOf.get(categoryId) ?? null;
  const seen = new Set<string>([categoryId]);
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    depth += 1;
    cursor = parentOf.get(cursor) ?? null;
  }
  return depth;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Trigram similarity needs at least three characters to mean anything, so a one
 * or two character query is treated as a prefix search instead of a fuzzy one.
 */
export const MIN_TRIGRAM_QUERY_LENGTH = 3;

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').slice(0, MAX_SEARCH_QUERY_LENGTH);
}

/**
 * The longest search query worth running.
 *
 * Nobody types a hundred characters looking for rice; what does send one is a
 * crawler, a paste accident, or somebody probing. Trigram similarity over a
 * very long string is expensive and its answer is meaningless, so the query is
 * *truncated* rather than rejected — a shopper who pasted a paragraph still
 * gets results for the start of it instead of an error page.
 */
export const MAX_SEARCH_QUERY_LENGTH = 100;

/**
 * Turn a search query into an `ILIKE` pattern that means what it says.
 *
 * Parameterising the query stops SQL injection, but it does **not** stop
 * `LIKE` metacharacters: `%` and `_` are wildcards *inside* the pattern
 * whatever route the text took to get there, so a shopper searching for `%`
 * was matching the entire catalogue and one searching for "100% Pure" was
 * really searching for "100(anything) Pure".
 *
 * Escaping them — and the escape character itself, first, or the escaping is
 * itself escapable — makes the pattern a literal substring search. Pairs with
 * `ESCAPE '\'` on the query side.
 */
export function likePattern(query: string): string {
  const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped}%`;
}

/**
 * A category and everything under it.
 *
 * Browsing "Staples" must show the rice in "Staples > Rice", so a category page
 * is a *subtree* query, not an equality one. Written against the edge list the
 * cycle check already loads, and it tolerates a cycle rather than hanging on
 * one: `seen` bounds the walk even if the data is somehow broken.
 */
export function descendantCategoryIds(
  nodes: readonly CategoryNode[],
  rootId: string,
): readonly string[] {
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.parentId === null) continue;
    const siblings = childrenOf.get(node.parentId) ?? [];
    siblings.push(node.id);
    childrenOf.set(node.parentId, siblings);
  }

  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const child of childrenOf.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return [...seen];
}

/**
 * The path from the root down to a category, for a breadcrumb.
 *
 * Returns the trail it managed to walk rather than throwing on a broken parent
 * link: a missing breadcrumb is a cosmetic problem, and a product page that 500s
 * because of one is not.
 */
export function categoryTrail<T extends CategoryNode>(
  nodes: readonly T[],
  categoryId: string,
): readonly T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const trail: T[] = [];
  const seen = new Set<string>();

  let cursor: string | null = categoryId;
  while (cursor !== null && !seen.has(cursor)) {
    seen.add(cursor);
    const node = byId.get(cursor);
    if (node === undefined) break;
    trail.unshift(node);
    cursor = node.parentId;
  }
  return trail;
}
