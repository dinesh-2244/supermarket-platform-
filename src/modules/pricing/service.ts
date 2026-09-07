/**
 * Use-cases for `pricing`. Services open transactions, enforce authorization and
 * emit domain events; they are the only thing `index.ts` exposes.
 */
import {
  assertAuthorized,
  emit,
  NotFoundError,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type Principal,
} from '../platform/index';
import { getProduct } from '../catalog/index';
import { getStore } from '../stores/index';
import {
  assertPrice,
  descriptor,
  discountBp,
  priceChanged,
  type ModuleDescriptor,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type { PriceChangeRecord, StoreProductRecord } from './repo';
export { discountBp };

export async function listListings(
  principal: Principal,
  options: { storeId?: string; listedOnly?: boolean; limit?: number } = {},
): Promise<readonly repo.StoreProductRecord[]> {
  assertAuthorized(principal, 'store-product:read', {
    type: 'StoreProduct',
    storeId: options.storeId ?? scopeOf(principal),
  });
  return repo.listListings(principal, options);
}

export async function getListing(
  principal: Principal,
  storeId: string,
  productId: string,
): Promise<repo.StoreProductRecord | null> {
  assertAuthorized(principal, 'store-product:read', { type: 'StoreProduct', storeId });
  return repo.findListingForPair(storeId, productId);
}

export interface SetPriceInput {
  readonly mrpPaise: number;
  readonly sellingPricePaise: number;
  readonly reason?: string | null;
}

/**
 * Set a store's price for a product, recording the move.
 *
 * The `PriceChange` row is written **in the same transaction** as the
 * `StoreProduct` update, so there is no window in which a price exists with no
 * history explaining it. `PriceChange` is the domain history; the `AuditLog` row
 * alongside it is the generic sensitive-mutation trail — they answer different
 * questions ("how has this price moved?" vs "what did this user change today?")
 * and the plan asks for both.
 *
 * A no-op edit writes neither: a history full of "changed from 120 to 120" rows
 * is a history nobody reads.
 */
export async function setPrice(
  principal: Principal,
  storeId: string,
  productId: string,
  input: SetPriceInput,
): Promise<repo.StoreProductRecord> {
  assertAuthorized(principal, 'store-product:set-price', { type: 'StoreProduct', storeId });
  assertPrice(input);

  // Both must exist. The FK would catch it, but a foreign-key error is not a
  // message anyone can act on — and listing a product that is not in the shared
  // master is exactly what ADR-0003 rules out.
  await getStore(principal, storeId);
  await getProduct(principal, productId);

  const before = await repo.findListingForPair(storeId, productId);

  const after = await withTransaction(async (tx) => {
    const listing = await repo.upsertListing(tx, {
      storeId,
      productId,
      mrpPaise: input.mrpPaise,
      sellingPricePaise: input.sellingPricePaise,
      isListed: before?.isListed ?? true,
      listedAt: before?.listedAt ?? new Date(),
    });

    const moved =
      before === null ||
      priceChanged(before, {
        mrpPaise: input.mrpPaise,
        sellingPricePaise: input.sellingPricePaise,
      });

    if (moved) {
      await repo.insertPriceChange(tx, {
        storeProductId: listing.id,
        oldSellingPricePaise: before?.sellingPricePaise ?? 0,
        newSellingPricePaise: listing.sellingPricePaise,
        oldMrpPaise: before?.mrpPaise ?? 0,
        newMrpPaise: listing.mrpPaise,
        actorUserId: principal.kind === 'user' ? principal.userId : null,
        reason: input.reason ?? null,
      });

      await writeAuditLog(tx, {
        principal,
        action: 'set-price',
        entityType: 'StoreProduct',
        entityId: listing.id,
        before,
        after: listing,
      });
    }

    return { listing, moved };
  });

  if (after.moved) {
    emit('price.changed', {
      storeProductId: after.listing.id,
      oldPricePaise: before?.sellingPricePaise ?? 0,
      newPricePaise: after.listing.sellingPricePaise,
    });
  }
  return after.listing;
}

/**
 * List or unlist a product in one store. Listing is per store and independent:
 * store A hiding a product says nothing about store B.
 */
export async function setListed(
  principal: Principal,
  storeId: string,
  productId: string,
  isListed: boolean,
): Promise<repo.StoreProductRecord> {
  assertAuthorized(principal, 'store-product:list', { type: 'StoreProduct', storeId });

  const before = await repo.findListingForPair(storeId, productId);
  if (before === null) {
    throw new NotFoundError('That product is not set up for this store yet — set a price first', {
      storeId,
      productId,
    });
  }
  if (before.isListed === isListed) return before;

  return withTransaction(async (tx) => {
    const after = await repo.updateListing(tx, before.id, {
      isListed,
      // First time it goes live, remember when.
      ...(isListed && before.listedAt === null ? { listedAt: new Date() } : {}),
    });
    await writeAuditLog(tx, {
      principal,
      action: isListed ? 'list' : 'unlist',
      entityType: 'StoreProduct',
      entityId: before.id,
      before,
      after,
    });
    return after;
  });
}

/** The append-only price history for one store's listing. */
export async function listPriceHistory(
  principal: Principal,
  storeProductId: string,
  limit = 100,
): Promise<readonly repo.PriceChangeRecord[]> {
  const listing = await repo.findListing(storeProductId);
  if (listing === null) throw new NotFoundError('Listing not found', { storeProductId });
  assertAuthorized(principal, 'price-change:read', {
    type: 'PriceChange',
    storeId: listing.storeId,
  });
  if (limit <= 0) throw new ValidationError('limit must be positive', { limit });
  return repo.listPriceHistory(storeProductId, Math.min(limit, 500));
}

/** The store a scoped principal acts in; `null` when it is unscoped. */
function scopeOf(principal: Principal): string | null {
  return principal.kind === 'user' ? principal.storeId : null;
}
