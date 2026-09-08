/**
 * Prisma / SQL access for `catalog`. Private to this module: nothing outside
 * `src/modules/catalog` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * Read helpers take a `DbExecutor` so a caller inside a transaction can pass its
 * `Tx` handle and see its own uncommitted writes. Audited writes take a `Tx` and
 * nothing else — see `auditedExecutor` (§17).
 */
import { getPrisma, Prisma, type DbExecutor, type Tx } from '../platform/index';
import type { CategoryNode } from './domain/index';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

/**
 * The executor to run an *audited write* on.
 *
 * Deliberately has no `getPrisma()` fallback and takes the branded `Tx` that
 * only `withTransaction` can mint: a catalogue change without its `AuditLog` row
 * in the same commit is the failure mode §3/§17 exists to prevent.
 */
export function auditedExecutor(tx: Tx): Tx {
  return tx;
}

export interface CategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly parentId: string | null;
  readonly sortKey: number;
  readonly isActive: boolean;
}

export interface ProductRecord {
  readonly id: string;
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly brand: string | null;
  readonly packSize: string;
  readonly categoryId: string;
  readonly aisleSortKey: number;
  readonly isActive: boolean;
}

export interface ImageRecord {
  readonly id: string;
  readonly productId: string;
  readonly url: string;
  readonly sortKey: number;
  readonly alt: string | null;
}

const productSelect = {
  id: true,
  sku: true,
  name: true,
  slug: true,
  description: true,
  brand: true,
  packSize: true,
  categoryId: true,
  aisleSortKey: true,
  isActive: true,
} as const;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(db?: DbExecutor): Promise<readonly CategoryRecord[]> {
  return executor(db).category.findMany({ orderBy: [{ sortKey: 'asc' }, { name: 'asc' }] });
}

/** Just the edges, for the cycle check. */
export async function loadCategoryNodes(db?: DbExecutor): Promise<readonly CategoryNode[]> {
  return executor(db).category.findMany({ select: { id: true, parentId: true } });
}

export async function findCategory(id: string, db?: DbExecutor): Promise<CategoryRecord | null> {
  return executor(db).category.findUnique({ where: { id } });
}

/**
 * Serialise every category-hierarchy mutation against one advisory lock.
 *
 * A cycle is a property of the whole tree, not of one row, so locking the two
 * categories involved is not enough: `updateCategory(A,{parent:B})` and
 * `updateCategory(B,{parent:A})` each validated against a tree that was still
 * acyclic, then both committed, leaving A→B→A. There is no row whose lock both
 * transactions would contend for.
 *
 * A transaction-scoped advisory lock is the cheap fix: reparenting is rare, and
 * making it strictly serial costs nothing anyone will notice. The lock is
 * released automatically when the transaction ends, so a failure cannot strand
 * it. The constant is an arbitrary but fixed key for "the category tree".
 */
const CATEGORY_TREE_LOCK = 0x0ca7_e0_01;

export async function lockCategoryTree(tx: Tx): Promise<void> {
  await auditedExecutor(tx).$executeRaw`SELECT pg_advisory_xact_lock(${CATEGORY_TREE_LOCK})`;
}

export async function insertCategory(
  tx: Tx,
  row: { name: string; slug: string; parentId: string | null; sortKey: number },
): Promise<CategoryRecord> {
  return auditedExecutor(tx).category.create({ data: { ...row } });
}

export async function updateCategoryRow(
  tx: Tx,
  id: string,
  row: {
    name?: string;
    slug?: string;
    parentId?: string | null;
    sortKey?: number;
    isActive?: boolean;
  },
): Promise<CategoryRecord> {
  return auditedExecutor(tx).category.update({ where: { id }, data: { ...row } });
}

export async function countProductsInCategory(id: string, db?: DbExecutor): Promise<number> {
  return executor(db).product.count({ where: { categoryId: id } });
}

export async function countChildCategories(id: string, db?: DbExecutor): Promise<number> {
  return executor(db).category.count({ where: { parentId: id } });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function findProduct(id: string, db?: DbExecutor): Promise<ProductRecord | null> {
  return executor(db).product.findUnique({ where: { id }, select: productSelect });
}

export async function findProductBySku(
  sku: string,
  db?: DbExecutor,
): Promise<ProductRecord | null> {
  return executor(db).product.findUnique({ where: { sku }, select: productSelect });
}

export async function listProducts(
  options: {
    categoryId?: string;
    categoryIds?: readonly string[];
    productIds?: readonly string[];
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
  },
  db?: DbExecutor,
): Promise<readonly ProductRecord[]> {
  return executor(db).product.findMany({
    where: {
      ...(options.categoryId !== undefined ? { categoryId: options.categoryId } : {}),
      ...(options.categoryIds !== undefined
        ? { categoryId: { in: [...options.categoryIds] } }
        : {}),
      ...(options.productIds !== undefined ? { id: { in: [...options.productIds] } } : {}),
      ...(options.includeInactive === true ? {} : { isActive: true }),
    },
    select: productSelect,
    orderBy: [{ aisleSortKey: 'asc' }, { name: 'asc' }],
    take: options.limit ?? 200,
    ...(options.offset !== undefined ? { skip: options.offset } : {}),
  });
}

/** How many products a browse query has in total, for "page 2 of 5". */
export async function countProducts(
  options: {
    categoryIds?: readonly string[];
    productIds?: readonly string[];
    includeInactive?: boolean;
  },
  db?: DbExecutor,
): Promise<number> {
  return executor(db).product.count({
    where: {
      ...(options.categoryIds !== undefined
        ? { categoryId: { in: [...options.categoryIds] } }
        : {}),
      ...(options.productIds !== undefined ? { id: { in: [...options.productIds] } } : {}),
      ...(options.includeInactive === true ? {} : { isActive: true }),
    },
  });
}

export async function findProductBySlug(
  slug: string,
  db?: DbExecutor,
): Promise<ProductRecord | null> {
  return executor(db).product.findUnique({ where: { slug }, select: productSelect });
}

export interface InsertProductRow {
  readonly sku: string;
  readonly name: string;
  readonly slug: string;
  readonly packSize: string;
  readonly categoryId: string;
  readonly description?: string | null;
  readonly brand?: string | null;
  readonly aisleSortKey?: number;
}

export async function insertProduct(tx: Tx, row: InsertProductRow): Promise<ProductRecord> {
  return auditedExecutor(tx).product.create({ data: { ...row }, select: productSelect });
}

export async function updateProductRow(
  tx: Tx,
  id: string,
  row: Record<string, unknown>,
): Promise<ProductRecord> {
  return auditedExecutor(tx).product.update({
    where: { id },
    data: row as never,
    select: productSelect,
  });
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export async function listImages(
  productId: string,
  db?: DbExecutor,
): Promise<readonly ImageRecord[]> {
  return executor(db).productImage.findMany({
    where: { productId },
    orderBy: { sortKey: 'asc' },
  });
}

export async function findImage(id: string, db?: DbExecutor): Promise<ImageRecord | null> {
  return executor(db).productImage.findUnique({ where: { id } });
}

export async function insertImage(
  tx: Tx,
  row: { productId: string; url: string; sortKey: number; alt: string | null },
): Promise<ImageRecord> {
  return auditedExecutor(tx).productImage.create({ data: { ...row } });
}

export async function updateImageSortKey(tx: Tx, id: string, sortKey: number): Promise<void> {
  await auditedExecutor(tx).productImage.update({ where: { id }, data: { sortKey } });
}

export async function deleteImage(tx: Tx, id: string): Promise<void> {
  await auditedExecutor(tx).productImage.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit extends ProductRecord {
  readonly score: number;
}

/**
 * Trigram search over name + brand, backed by the GIN indexes the
 * `20260907200000_catalog_search_trgm` migration creates.
 *
 * Raw SQL because Prisma has no `similarity()`. `ILIKE` is OR-ed in so an exact
 * substring still wins when the query is too short for trigrams to be useful,
 * and the score is what orders the results — a plain `ILIKE` list comes back in
 * whatever order the planner felt like.
 */
export async function searchProducts(
  query: string,
  options: { limit: number; minScore: number; includeInactive: boolean },
  db?: DbExecutor,
): Promise<readonly SearchHit[]> {
  const pattern = `%${query}%`;
  return executor(db).$queryRaw<SearchHit[]>`
    SELECT "id", "sku", "name", "slug", "description", "brand", "packSize",
           "categoryId", "aisleSortKey", "isActive",
           GREATEST(
             similarity("name", ${query}),
             similarity(COALESCE("brand", ''), ${query}),
             CASE WHEN "name" ILIKE ${pattern} THEN 1.0 ELSE 0 END,
             CASE WHEN COALESCE("brand", '') ILIKE ${pattern} THEN 0.9 ELSE 0 END
           )::float8 AS "score"
    FROM "Product"
    WHERE (${options.includeInactive} OR "isActive" = true)
      AND (
        "name" ILIKE ${pattern}
        OR COALESCE("brand", '') ILIKE ${pattern}
        OR similarity("name", ${query}) >= ${options.minScore}
        OR similarity(COALESCE("brand", ''), ${query}) >= ${options.minScore}
      )
    ORDER BY "score" DESC, "name" ASC
    LIMIT ${options.limit}
  `;
}

/** Confirms the extension is installed — asserted by the schema test. */
export async function hasTrigramExtension(db?: DbExecutor): Promise<boolean> {
  const rows = await executor(db).$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM pg_extension WHERE extname = 'pg_trgm'
  `;
  return Number(rows[0]?.count ?? 0n) > 0;
}

export { Prisma };
