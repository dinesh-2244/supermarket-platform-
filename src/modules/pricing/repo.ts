/**
 * Prisma / SQL access for `pricing`. Private to this module: nothing outside
 * `src/modules/pricing` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * Read helpers take a `DbExecutor` so a caller inside a transaction can pass its
 * `Tx` handle and see its own uncommitted writes. Audited writes take a `Tx` and
 * nothing else — see `auditedExecutor` (§17).
 */
import {
  getPrisma,
  scopedWhere,
  type DbExecutor,
  type Principal,
  type Tx,
} from '../platform/index';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

/**
 * The executor to run an *audited write* on.
 *
 * Deliberately has no `getPrisma()` fallback and takes the branded `Tx` that
 * only `withTransaction` can mint: a price change without its `PriceChange` row
 * in the same commit is the failure mode §3/§17 exists to prevent.
 */
export function auditedExecutor(tx: Tx): Tx {
  return tx;
}

export interface StoreProductRecord {
  readonly id: string;
  readonly storeId: string;
  readonly productId: string;
  readonly isListed: boolean;
  readonly mrpPaise: number;
  readonly sellingPricePaise: number;
  readonly listedAt: Date | null;
}

export interface PriceChangeRecord {
  readonly id: string;
  readonly storeProductId: string;
  readonly oldSellingPricePaise: number;
  readonly newSellingPricePaise: number;
  readonly oldMrpPaise: number;
  readonly newMrpPaise: number;
  readonly actorUserId: string | null;
  readonly reason: string | null;
  readonly createdAt: Date;
}

const listingSelect = {
  id: true,
  storeId: true,
  productId: true,
  isListed: true,
  mrpPaise: true,
  sellingPricePaise: true,
  listedAt: true,
} as const;

export async function findListing(id: string, db?: DbExecutor): Promise<StoreProductRecord | null> {
  return executor(db).storeProduct.findUnique({ where: { id }, select: listingSelect });
}

export async function findListingForPair(
  storeId: string,
  productId: string,
  db?: DbExecutor,
): Promise<StoreProductRecord | null> {
  return executor(db).storeProduct.findUnique({
    where: { storeId_productId: { storeId, productId } },
    select: listingSelect,
  });
}

/**
 * Listings the principal may see. The scope filter lives here rather than in the
 * caller: a store-bound list that forgets it is an IDOR.
 *
 * `productIds` narrows the query to specific products **in the database**, which
 * is the only safe way to ask "does this store list this?". Asking for a page of
 * listings and searching it in memory answers a different question — "is it in
 * the first `limit` of them?" — and a store with more listings than the limit
 * then reports its own products as unlisted (R6).
 */
export interface ListListingsOptions {
  readonly storeId?: string;
  readonly listedOnly?: boolean;
  readonly productIds?: readonly string[];
  readonly limit?: number;
}

export async function listListings(
  principal: Principal,
  options: ListListingsOptions,
  db?: DbExecutor,
): Promise<readonly StoreProductRecord[]> {
  return executor(db).storeProduct.findMany({
    where: scopedWhere(principal, {
      ...(options.storeId !== undefined ? { storeId: options.storeId } : {}),
      ...(options.listedOnly === true ? { isListed: true } : {}),
      ...(options.productIds !== undefined ? { productId: { in: [...options.productIds] } } : {}),
    }),
    select: listingSelect,
    orderBy: [{ storeId: 'asc' }, { productId: 'asc' }],
    take: options.limit ?? 500,
  });
}

/**
 * Every product id this store lists, complete and unpaginated.
 *
 * Deliberately **not** `listListings(...).map(...)`: that has a row limit, and a
 * truncated id set is indistinguishable from a small catalogue — which is how
 * the 501st listing became invisible to browse, search and the basket alike.
 * Only the id column is read, so "complete" costs one narrow index scan rather
 * than the whole listing table.
 */
export async function listListedProductIds(
  principal: Principal,
  storeId: string,
  db?: DbExecutor,
): Promise<readonly string[]> {
  const rows = await executor(db).storeProduct.findMany({
    where: scopedWhere(principal, { storeId, isListed: true }),
    select: { productId: true },
    orderBy: { productId: 'asc' },
  });
  return rows.map((row) => row.productId);
}

/**
 * Serialise every mutation of one store's listing of one product, whether or not
 * that listing exists yet.
 *
 * `lockListingForPair` below locks a row — which is exactly nothing when the row
 * is missing. Two concurrent *first* prices therefore both read `before === null`
 * and both recorded a history entry starting from zero (0→300 and 0→200), so the
 * very first price of a product had the same broken history R4 was raised about.
 * There is no row whose lock the two transactions would contend for, so the lock
 * has to be on the *key* rather than on the row.
 *
 * A transaction-scoped advisory lock on `(classid, hash(storeId:productId))` is
 * that key lock, taken before existence is read. It is released automatically
 * when the transaction ends, so a failure cannot strand it, and a hash collision
 * only makes two unrelated pairs briefly serial — never incorrect. Setting a
 * price is a rare human action; making it strictly serial per product costs
 * nothing anyone will notice.
 */
const LISTING_PAIR_LOCK = 0x0_11_57;

export async function lockListingPair(tx: Tx, storeId: string, productId: string): Promise<void> {
  await auditedExecutor(tx).$executeRaw`
    SELECT pg_advisory_xact_lock(
      ${LISTING_PAIR_LOCK}::int,
      hashtext(${`${storeId}:${productId}`})
    )
  `;
}

/**
 * Read a listing for mutation, holding its row lock until the transaction ends.
 *
 * Reading the before-state *outside* the transaction meant two concurrent edits
 * both saw the original price, and both wrote a `PriceChange` claiming to start
 * from it — so a 100→200→300 sequence was recorded as 100→200 and 100→300, and
 * the history no longer reconstructed the actual path. Raw SQL because Prisma
 * has no `FOR UPDATE`. Returns `null` when the store has no listing yet — the
 * caller must already hold {@link lockListingPair}, which is what serialises the
 * missing-row case.
 */
export async function lockListingForPair(
  tx: Tx,
  storeId: string,
  productId: string,
): Promise<StoreProductRecord | null> {
  const rows = await auditedExecutor(tx).$queryRaw<StoreProductRecord[]>`
    SELECT "id", "storeId", "productId", "isListed", "mrpPaise", "sellingPricePaise", "listedAt"
    FROM "StoreProduct"
    WHERE "storeId" = ${storeId} AND "productId" = ${productId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function upsertListing(
  tx: Tx,
  row: {
    storeId: string;
    productId: string;
    mrpPaise: number;
    sellingPricePaise: number;
    isListed: boolean;
    listedAt: Date | null;
  },
): Promise<StoreProductRecord> {
  return auditedExecutor(tx).storeProduct.upsert({
    where: { storeId_productId: { storeId: row.storeId, productId: row.productId } },
    update: {
      mrpPaise: row.mrpPaise,
      sellingPricePaise: row.sellingPricePaise,
      isListed: row.isListed,
      listedAt: row.listedAt,
    },
    create: { ...row },
    select: listingSelect,
  });
}

export async function updateListing(
  tx: Tx,
  id: string,
  row: {
    mrpPaise?: number;
    sellingPricePaise?: number;
    isListed?: boolean;
    listedAt?: Date | null;
  },
): Promise<StoreProductRecord> {
  return auditedExecutor(tx).storeProduct.update({
    where: { id },
    data: { ...row },
    select: listingSelect,
  });
}

/** Append-only: written in the same transaction as the price it records. */
export async function insertPriceChange(
  tx: Tx,
  row: {
    storeProductId: string;
    oldSellingPricePaise: number;
    newSellingPricePaise: number;
    oldMrpPaise: number;
    newMrpPaise: number;
    actorUserId: string | null;
    reason: string | null;
  },
): Promise<PriceChangeRecord> {
  return auditedExecutor(tx).priceChange.create({ data: { ...row } });
}

export async function listPriceHistory(
  storeProductId: string,
  limit: number,
  db?: DbExecutor,
): Promise<readonly PriceChangeRecord[]> {
  return executor(db).priceChange.findMany({
    where: { storeProductId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
