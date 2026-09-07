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
  storeScopeFilter,
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
 */
export async function listListings(
  principal: Principal,
  options: { storeId?: string; listedOnly?: boolean; limit?: number },
  db?: DbExecutor,
): Promise<readonly StoreProductRecord[]> {
  return executor(db).storeProduct.findMany({
    where: {
      ...storeScopeFilter(principal),
      ...(options.storeId !== undefined ? { storeId: options.storeId } : {}),
      ...(options.listedOnly === true ? { isListed: true } : {}),
    },
    select: listingSelect,
    orderBy: [{ storeId: 'asc' }, { productId: 'asc' }],
    take: options.limit ?? 500,
  });
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
