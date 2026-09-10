/**
 * Use-cases for `catalog`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 *
 * The catalogue master is **global** (R1 / ADR-0003): one `Product` row per real
 * product, shared by every store. That is why writes here need an unscoped grant
 * — a store manager editing the master would silently change the other store's
 * listings.
 */
import {
  assertAuthorized,
  ConflictError,
  emit,
  NotFoundError,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type Principal,
} from '../platform/index';
import {
  assertImageUrl,
  assertNoCycle,
  assertRequiredName,
  assertSku,
  assertSlug,
  descriptor,
  MIN_TRIGRAM_QUERY_LENGTH,
  normalizeSearchQuery,
  slugify,
  type ModuleDescriptor,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type { CategoryRecord, ImageRecord, ProductRecord, SearchHit } from './repo';

const CATALOG = { type: 'Product' } as const;
const CATEGORY = { type: 'Category' } as const;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(
  principal: Principal,
): Promise<readonly repo.CategoryRecord[]> {
  assertAuthorized(principal, 'category:read', CATEGORY);
  return repo.listCategories();
}

export async function createCategory(
  principal: Principal,
  input: { name: string; slug?: string; parentId?: string | null; sortKey?: number },
): Promise<repo.CategoryRecord> {
  assertAuthorized(principal, 'category:write', CATEGORY);
  const name = assertRequiredName(input.name, 'Category name');
  const slug = input.slug === undefined ? slugify(name) : assertSlug(input.slug);
  const parentId = input.parentId ?? null;

  if (parentId !== null && (await repo.findCategory(parentId)) === null) {
    throw new ValidationError('The parent category does not exist', { parentId });
  }

  return withTransaction(async (tx) => {
    const category = await repo
      .insertCategory(tx, { name, slug, parentId, sortKey: input.sortKey ?? 0 })
      .catch(conflictOn('slug', 'A category with that slug already exists', { slug }));

    await writeAuditLog(tx, {
      principal,
      action: 'create',
      entityType: 'Category',
      entityId: category.id,
      // The catalogue master is global (ADR-0003), so this belongs to no store.
      storeId: null,
      after: category,
    });
    return category;
  });
}

export async function updateCategory(
  principal: Principal,
  categoryId: string,
  input: {
    name?: string;
    slug?: string;
    parentId?: string | null;
    sortKey?: number;
    isActive?: boolean;
  },
): Promise<repo.CategoryRecord> {
  assertAuthorized(principal, 'category:write', { ...CATEGORY, id: categoryId });

  return withTransaction(async (tx) => {
    // Serialise hierarchy changes before reading the tree. A cycle is a property
    // of the whole tree, so two reparentings that each validate against an
    // acyclic snapshot can still commit one between them — there is no single
    // row whose lock they would contend for.
    if (input.parentId !== undefined) await repo.lockCategoryTree(tx);

    const before = await repo.findCategory(categoryId, tx);
    if (before === null) throw new NotFoundError('Category not found', { categoryId });

    // Detection now runs *inside* the protected section, against the tree as it
    // actually is, not as it was before a concurrent writer moved something.
    if (input.parentId !== undefined) {
      assertNoCycle(categoryId, input.parentId, await repo.loadCategoryNodes(tx));
    }

    const after = await repo
      .updateCategoryRow(tx, categoryId, {
        ...(input.name !== undefined
          ? { name: assertRequiredName(input.name, 'Category name') }
          : {}),
        ...(input.slug !== undefined ? { slug: assertSlug(input.slug) } : {}),
        ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
        ...(input.sortKey !== undefined ? { sortKey: input.sortKey } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .catch(conflictOn('slug', 'A category with that slug already exists', {}));

    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'Category',
      entityId: categoryId,
      // The catalogue master is global (ADR-0003), so this belongs to no store.
      storeId: null,
      before,
      after,
    });
    return after;
  });
}

/**
 * Deactivate rather than delete: a category with products behind it is
 * referenced by `Product.categoryId`, and deleting it would either orphan them
 * or cascade the delete into the master.
 */
export async function deactivateCategory(
  principal: Principal,
  categoryId: string,
): Promise<repo.CategoryRecord> {
  assertAuthorized(principal, 'category:write', { ...CATEGORY, id: categoryId });
  if ((await repo.countChildCategories(categoryId)) > 0) {
    throw new ConflictError('Move or deactivate the child categories first', { categoryId });
  }
  return updateCategory(principal, categoryId, { isActive: false });
}

// ---------------------------------------------------------------------------
// Products (the shared global master)
// ---------------------------------------------------------------------------

export async function listProducts(
  principal: Principal,
  options: {
    categoryId?: string;
    categoryIds?: readonly string[];
    productIds?: readonly string[];
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
  } = {},
): Promise<readonly repo.ProductRecord[]> {
  assertAuthorized(principal, 'product:read', CATALOG);
  return repo.listProducts(options);
}

/** The total a browse query would return, for paging. */
export async function countProducts(
  principal: Principal,
  options: {
    categoryIds?: readonly string[];
    productIds?: readonly string[];
    includeInactive?: boolean;
  } = {},
): Promise<number> {
  assertAuthorized(principal, 'product:read', CATALOG);
  return repo.countProducts(options);
}

/**
 * Resolve a product by its **global** slug.
 *
 * The slug identifies a product across the whole platform (§8); which store the
 * request came from decides whether it is listed, what it costs and whether it
 * is in stock. Keeping those two questions separate is what lets one URL be
 * shared between customers of either shop.
 */
/**
 * Resolve SKUs to product ids in one query — the CSV import's hot path.
 *
 * `inventory` used to query `Product` itself, which is `catalog`'s table (§4);
 * pinned as a known exception and tracked as `p3-followup-model-ownership`.
 * Authorized like every other catalogue read: the importer is staff and holds
 * `product:read`, so nothing here is looser than the screen they came from.
 *
 * A SKU with no product is simply absent from the map — the import reports it
 * per row, which is a better error than a partial failure.
 */
export async function findProductIdsBySku(
  principal: Principal,
  skus: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  assertAuthorized(principal, 'product:read', CATALOG);
  if (skus.length === 0) return new Map();
  return repo.findProductIdsBySku(skus);
}

export async function getProductBySlug(
  principal: Principal,
  slug: string,
): Promise<repo.ProductRecord | null> {
  assertAuthorized(principal, 'product:read', CATALOG);
  return repo.findProductBySlug(slug);
}

export async function getProduct(
  principal: Principal,
  productId: string,
): Promise<repo.ProductRecord> {
  assertAuthorized(principal, 'product:read', { ...CATALOG, id: productId });
  const product = await repo.findProduct(productId);
  if (product === null) throw new NotFoundError('Product not found', { productId });
  return product;
}

export async function getProductBySku(
  principal: Principal,
  sku: string,
): Promise<repo.ProductRecord | null> {
  assertAuthorized(principal, 'product:read', CATALOG);
  return repo.findProductBySku(assertSku(sku));
}

export interface CreateProductInput {
  readonly sku: string;
  readonly name: string;
  readonly packSize: string;
  readonly categoryId: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly brand?: string | null;
  readonly aisleSortKey?: number;
}

export async function createProduct(
  principal: Principal,
  input: CreateProductInput,
): Promise<repo.ProductRecord> {
  assertAuthorized(principal, 'product:write', CATALOG);

  const sku = assertSku(input.sku);
  const name = assertRequiredName(input.name);
  const slug = input.slug === undefined ? slugify(name) : assertSlug(input.slug);
  const packSize = assertRequiredName(input.packSize, 'Pack size');

  if ((await repo.findCategory(input.categoryId)) === null) {
    throw new ValidationError('That category does not exist', { categoryId: input.categoryId });
  }

  const created = await withTransaction(async (tx) => {
    const product = await repo
      .insertProduct(tx, {
        sku,
        name,
        slug,
        packSize,
        categoryId: input.categoryId,
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.brand !== undefined ? { brand: input.brand } : {}),
        ...(input.aisleSortKey !== undefined ? { aisleSortKey: input.aisleSortKey } : {}),
      })
      .catch(conflictOn('sku', 'A product with that SKU or slug already exists', { sku, slug }));

    await writeAuditLog(tx, {
      principal,
      action: 'create',
      entityType: 'Product',
      entityId: product.id,
      // The catalogue master is global (ADR-0003), so this belongs to no store.
      storeId: null,
      after: product,
    });
    return product;
  });

  emit('product.updated', { productId: created.id });
  return created;
}

export interface UpdateProductInput {
  readonly name?: string;
  readonly slug?: string;
  readonly description?: string | null;
  readonly brand?: string | null;
  readonly packSize?: string;
  readonly categoryId?: string;
  readonly aisleSortKey?: number;
  readonly isActive?: boolean;
}

export async function updateProduct(
  principal: Principal,
  productId: string,
  input: UpdateProductInput,
): Promise<repo.ProductRecord> {
  assertAuthorized(principal, 'product:write', { ...CATALOG, id: productId });
  const before = await repo.findProduct(productId);
  if (before === null) throw new NotFoundError('Product not found', { productId });

  if (input.categoryId !== undefined && (await repo.findCategory(input.categoryId)) === null) {
    throw new ValidationError('That category does not exist', { categoryId: input.categoryId });
  }

  const after = await withTransaction(async (tx) => {
    const updated = await repo
      .updateProductRow(tx, productId, {
        ...(input.name !== undefined ? { name: assertRequiredName(input.name) } : {}),
        ...(input.slug !== undefined ? { slug: assertSlug(input.slug) } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.brand !== undefined ? { brand: input.brand } : {}),
        ...(input.packSize !== undefined
          ? { packSize: assertRequiredName(input.packSize, 'Pack size') }
          : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.aisleSortKey !== undefined ? { aisleSortKey: input.aisleSortKey } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .catch(conflictOn('slug', 'A product with that slug already exists', {}));

    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'Product',
      entityId: productId,
      // The catalogue master is global (ADR-0003), so this belongs to no store.
      storeId: null,
      before,
      after: updated,
    });
    return updated;
  });

  emit('product.updated', { productId });
  return after;
}

/**
 * Deactivate, never delete. A product is referenced by `StoreProduct`,
 * `InventoryItem`, `StockLedger` and eventually order lines — deleting it would
 * take the history with it. `isActive: false` hides it everywhere it matters.
 */
export async function deactivateProduct(
  principal: Principal,
  productId: string,
): Promise<repo.ProductRecord> {
  return updateProduct(principal, productId, { isActive: false });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function listProductImages(
  principal: Principal,
  productId: string,
): Promise<readonly repo.ImageRecord[]> {
  assertAuthorized(principal, 'product:read', { ...CATALOG, id: productId });
  return repo.listImages(productId);
}

/** Takes a URL — object-storage upload wiring is out of scope this phase. */
export async function addProductImage(
  principal: Principal,
  productId: string,
  input: { url: string; alt?: string | null; sortKey?: number },
): Promise<repo.ImageRecord> {
  assertAuthorized(principal, 'product-image:write', { ...CATALOG, id: productId });
  if ((await repo.findProduct(productId)) === null) {
    throw new NotFoundError('Product not found', { productId });
  }

  const url = assertImageUrl(input.url);
  const existing = await repo.listImages(productId);
  const sortKey = input.sortKey ?? existing.length;

  return withTransaction(async (tx) => {
    const image = await repo.insertImage(tx, {
      productId,
      url,
      sortKey,
      alt: input.alt ?? null,
    });
    await writeAuditLog(tx, {
      principal,
      action: 'create',
      entityType: 'ProductImage',
      entityId: image.id,
      // The catalogue master is global (ADR-0003), so this belongs to no store.
      storeId: null,
      after: image,
    });
    return image;
  });
}

/** Reorder in one transaction — a half-applied order is a visibly broken gallery. */
export async function reorderProductImages(
  principal: Principal,
  productId: string,
  orderedImageIds: readonly string[],
): Promise<readonly repo.ImageRecord[]> {
  assertAuthorized(principal, 'product-image:write', { ...CATALOG, id: productId });

  const existing = await repo.listImages(productId);
  const known = new Set(existing.map((image) => image.id));
  const requested = new Set(orderedImageIds);

  // Length + membership alone accepted `[A, A]` for a two-image product: it is
  // the right length and every entry is known, but B is never assigned a sort
  // key and both images end up at the same position. Uniqueness and exact set
  // equality are what "once each" actually means.
  const sameSize = requested.size === orderedImageIds.length && requested.size === known.size;
  if (!sameSize || orderedImageIds.some((id) => !known.has(id))) {
    throw new ValidationError('The new order must list exactly this product’s images once each', {
      productId,
      expected: known.size,
      received: orderedImageIds.length,
      distinct: requested.size,
    });
  }

  return withTransaction(async (tx) => {
    for (const [index, id] of orderedImageIds.entries()) {
      await repo.updateImageSortKey(tx, id, index);
    }
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'ProductImage',
      entityId: productId,
      // The catalogue master is global (ADR-0003), so this belongs to no store.
      storeId: null,
      before: existing.map((image) => image.id),
      after: orderedImageIds,
    });
    return repo.listImages(productId, tx);
  });
}

export async function removeProductImage(principal: Principal, imageId: string): Promise<void> {
  const image = await repo.findImage(imageId);
  if (image === null) throw new NotFoundError('Image not found', { imageId });
  assertAuthorized(principal, 'product-image:write', { ...CATALOG, id: image.productId });

  await withTransaction(async (tx) => {
    await repo.deleteImage(tx, imageId);
    await writeAuditLog(tx, {
      principal,
      action: 'update',
      entityType: 'ProductImage',
      entityId: imageId,
      // The catalogue master is global (ADR-0003), so this belongs to no store.
      storeId: null,
      before: image,
    });
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchOptions {
  readonly limit?: number;
  readonly includeInactive?: boolean;
  /**
   * Restrict the search to these products.
   *
   * The storefront passes the ids its store actually lists, so a shopper's
   * search cannot surface the other store's exclusives — the scope is applied
   * *inside* the query rather than by filtering results afterwards, which would
   * let the other store's products consume the row limit.
   */
  readonly productIds?: readonly string[];
}

/**
 * Catalogue search, for the admin product list now and the storefront later.
 *
 * Trigram similarity is what lets a mistyped "basmti" find "Basmati Rice"; a
 * query too short for trigrams to mean anything falls back to substring only,
 * because at one or two characters `similarity()` matches almost everything.
 */
export async function searchProducts(
  principal: Principal,
  rawQuery: string,
  options: SearchOptions = {},
): Promise<readonly repo.SearchHit[]> {
  assertAuthorized(principal, 'product:read', CATALOG);

  const query = normalizeSearchQuery(rawQuery);
  if (query === '') return [];

  // An explicitly empty scope means "this store lists nothing", which must
  // return nothing — not everything, which is what an ignored empty filter does.
  if (options.productIds?.length === 0) return [];

  return repo.searchProducts(query, {
    limit: Math.min(options.limit ?? 50, 200),
    minScore: query.length < MIN_TRIGRAM_QUERY_LENGTH ? 1.1 : 0.3,
    includeInactive: options.includeInactive ?? false,
    ...(options.productIds === undefined ? {} : { productIds: options.productIds }),
  });
}

/** True when the `pg_trgm` extension the search relies on is installed. */
export async function searchIsAvailable(): Promise<boolean> {
  return repo.hasTrigramExtension();
}

/**
 * Turn a Prisma unique-constraint violation into a domain conflict. `sku` and
 * `slug` are unique at the database level, so this is the *database* refusing a
 * duplicate — the app-level check is only there to give a better message.
 */
function conflictOn(
  _field: string,
  message: string,
  context: Record<string, unknown>,
): (error: unknown) => never {
  return (error: unknown) => {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    ) {
      throw new ConflictError(message, context);
    }
    throw error;
  };
}
