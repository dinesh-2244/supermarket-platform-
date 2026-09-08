import {
  categoryTrail,
  countProducts,
  searchProducts,
  getProductBySlug,
  listCategories,
  listProductImages,
  listProducts,
  descendantCategoryIds,
  type CategoryRecord,
  type ProductRecord,
} from '@/modules/catalog';
import { availabilityFor, type AvailabilityRecord } from '@/modules/inventory';
import { getListing, listListedProductIds, listListings } from '@/modules/pricing';
import { type Principal } from '@/modules/platform';
import type { StoreContext } from '@/storefront';
import { storefrontPrincipal } from '@/storefront';

/**
 * Composing one store's shop window out of three modules (D2).
 *
 * The catalogue a shopper sees is not any one module's data: the *product* is
 * the shared global master (`catalog`), the *price and whether it is sold here
 * at all* belong to the store (`pricing`), and the *availability* to that
 * store's inventory. Architecture §4 keeps those three apart, so the join
 * happens here, above all of them, rather than one module reaching into
 * another's tables.
 *
 * Every call passes the storefront principal, so the store scoping is the same
 * `allowedStoreIds` check the back office uses — a page cannot widen its own
 * scope by asking differently.
 */

/** One product as the storefront shows it: master data, this store's terms. */
export interface ShopItem {
  readonly product: ProductRecord;
  readonly sellingPricePaise: number;
  readonly mrpPaise: number;
  readonly availability: AvailabilityRecord;
}

export interface ShopPage {
  readonly items: readonly ShopItem[];
  readonly total: number;
  readonly page: number;
  readonly pageCount: number;
}

/** Products per browse page. Small: this is a phone-first shop (arch §9). */
export const PAGE_SIZE = 24;

/**
 * The ids this store actually sells — **all** of them.
 *
 * `listedOnly` is the whole point: a product in the master that this shop has
 * not listed must not appear, at any price, on any page. What is equally the
 * point is that the set is *complete*. It is used as a filter on the product
 * query, and a truncated filter is not a smaller shop window, it is a wrong one:
 * a store whose listings ran past the old 500-row limit hid its own products
 * from browse, from search and from the basket, with no symptom to notice (R6).
 * Only the id column is read, so completeness costs one narrow index scan.
 */
async function listedProductIds(principal: Principal, storeId: string): Promise<readonly string[]> {
  return listListedProductIds(principal, storeId);
}

/**
 * This store's prices for the products on the page in front of the shopper.
 *
 * Looked up by explicit ids after paging rather than fetched wholesale before
 * it: a page shows two dozen products, and reading every listing in the store to
 * price them is both the slow way and the way that reintroduces a row limit.
 */
async function pricesFor(
  principal: Principal,
  storeId: string,
  productIds: readonly string[],
): Promise<ReadonlyMap<string, ShopPrice>> {
  if (productIds.length === 0) return new Map();
  const listings = await listListings(principal, {
    storeId,
    listedOnly: true,
    productIds,
    limit: productIds.length,
  });
  return new Map(
    listings.map((listing) => [
      listing.productId,
      { sellingPricePaise: listing.sellingPricePaise, mrpPaise: listing.mrpPaise },
    ]),
  );
}

interface ShopPrice {
  readonly sellingPricePaise: number;
  readonly mrpPaise: number;
}

/**
 * One page of this store's products, optionally within a category subtree.
 *
 * Ordering and paging are done by the product query — `aisleSortKey` then name,
 * the order the shelves are in — with the store's listed ids as a filter. Doing
 * it the other way round (page the listings, then look up products) would order
 * the shop by whatever the pricing table felt like.
 */
export async function shopPage(
  context: StoreContext,
  options: { categoryId?: string; page?: number } = {},
  customerId: string | null = null,
): Promise<ShopPage> {
  const principal = storefrontPrincipal(context, customerId);
  const storeId = context.serviceability.storeId;
  const page = Math.max(1, Math.trunc(options.page ?? 1));

  const ids = await listedProductIds(principal, storeId);
  if (ids.length === 0) return { items: [], total: 0, page: 1, pageCount: 1 };

  const categoryIds =
    options.categoryId === undefined
      ? undefined
      : descendantCategoryIds(await listCategories(principal), options.categoryId);

  const filter = {
    productIds: ids,
    ...(categoryIds === undefined ? {} : { categoryIds }),
  };

  const total = await countProducts(principal, filter);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  const products = await listProducts(principal, {
    ...filter,
    limit: PAGE_SIZE,
    offset: (safePage - 1) * PAGE_SIZE,
  });

  const pageIds = products.map((product) => product.id);
  const [availability, priceOf] = await Promise.all([
    availabilityFor(principal, storeId, pageIds),
    pricesFor(principal, storeId, pageIds),
  ]);

  return {
    items: products.flatMap((product) => toShopItem(product, priceOf, availability)),
    total,
    page: safePage,
    pageCount,
  };
}

/**
 * A product only becomes a `ShopItem` if this store prices it. A listing that
 * vanished between the two queries drops the row rather than rendering a
 * product with no price — there is no sensible placeholder for "costs unknown".
 */
function toShopItem(
  product: ProductRecord,
  priceOf: ReadonlyMap<string, ShopPrice>,
  availability: ReadonlyMap<string, AvailabilityRecord>,
): ShopItem[] {
  const price = priceOf.get(product.id);
  const stock = availability.get(product.id);
  if (price === undefined || stock === undefined) return [];
  return [{ product, ...price, availability: stock }];
}

export interface ProductPage extends ShopItem {
  readonly images: readonly { id: string; url: string; alt: string | null }[];
  readonly trail: readonly CategoryRecord[];
}

/**
 * One product page, or `null` when this store does not sell it.
 *
 * `null` covers three different situations on purpose — no such slug, a
 * deactivated product, and a product this shop has not listed — because the
 * page turns all three into the same 404. Distinguishing them for the visitor
 * would tell them what the *other* store sells, which is not theirs to know.
 */
export async function productPage(
  context: StoreContext,
  slug: string,
  customerId: string | null = null,
): Promise<ProductPage | null> {
  const principal = storefrontPrincipal(context, customerId);
  const storeId = context.serviceability.storeId;

  const product = await getProductBySlug(principal, slug);
  if (!product?.isActive) return null;

  // By key. Scanning a page of listings for this product answers "is it in the
  // first N?", which is a different question with the same shape (R6).
  const listing = await getListing(principal, storeId, product.id);
  if (listing?.isListed !== true) return null;

  const [availability, images, categories] = await Promise.all([
    availabilityFor(principal, storeId, [product.id]),
    listProductImages(principal, product.id),
    listCategories(principal),
  ]);

  const stock = availability.get(product.id);
  if (stock === undefined) return null;

  return {
    product,
    sellingPricePaise: listing.sellingPricePaise,
    mrpPaise: listing.mrpPaise,
    availability: stock,
    images: images.map((image) => ({ id: image.id, url: image.url, alt: image.alt })),
    trail: categoryTrail(categories, product.categoryId),
  };
}

/**
 * The categories this store actually has something in.
 *
 * A shop window that offers "Frozen" and then shows an empty shelf is worse
 * than one that does not offer it, so the nav is built from what is listed
 * rather than from the master tree.
 */
export async function shopCategories(
  context: StoreContext,
  customerId: string | null = null,
): Promise<readonly CategoryRecord[]> {
  const principal = storefrontPrincipal(context, customerId);
  const ids = await listedProductIds(principal, context.serviceability.storeId);
  if (ids.length === 0) return [];

  const products = await listProducts(principal, { productIds: ids, limit: ids.length });
  const stocked = new Set(products.map((product) => product.categoryId));
  const categories = await listCategories(principal);

  // A parent counts as stocked when any descendant is, so top-level nav works.
  return categories.filter(
    (category) =>
      category.isActive &&
      descendantCategoryIds(categories, category.id).some((id) => stocked.has(id)),
  );
}

/**
 * Search this store's shelves (D3).
 *
 * The scope is pushed *into* the query as an id list rather than applied to the
 * results: filtering afterwards would let the other store's products consume
 * the row limit and quietly shorten a shopper's results — worst exactly when
 * the two catalogues overlap least.
 *
 * The query itself never reaches SQL as text: `catalog.searchProducts`
 * parameterises it, so `%`, `_` and quotes are ordinary characters to search
 * for rather than syntax.
 */
export async function searchShop(
  context: StoreContext,
  rawQuery: string,
  options: { page?: number } = {},
  customerId: string | null = null,
): Promise<ShopPage> {
  const principal = storefrontPrincipal(context, customerId);
  const storeId = context.serviceability.storeId;
  const page = Math.max(1, Math.trunc(options.page ?? 1));

  const ids = await listedProductIds(principal, storeId);
  if (ids.length === 0) return { items: [], total: 0, page: 1, pageCount: 1 };

  const hits = await searchProducts(principal, rawQuery, {
    productIds: ids,
    limit: SEARCH_RESULT_LIMIT,
  });
  if (hits.length === 0) return { items: [], total: 0, page: 1, pageCount: 1 };

  // Paged in memory: the ranking is the whole value of a search result, and it
  // is computed by the query, so the page has to be a window on that order.
  const pageCount = Math.max(1, Math.ceil(hits.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const window = hits.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const windowIds = window.map((hit) => hit.id);
  const [availability, priceOf] = await Promise.all([
    availabilityFor(principal, storeId, windowIds),
    pricesFor(principal, storeId, windowIds),
  ]);

  return {
    items: window.flatMap((hit) => toShopItem(hit, priceOf, availability)),
    total: hits.length,
    page: safePage,
    pageCount,
  };
}

/**
 * How deep a search goes before it stops ranking.
 *
 * Beyond a few pages nobody is reading results, they are refining the query —
 * and an unbounded trigram scan is the one storefront query that could get
 * expensive on a shared database.
 */
export const SEARCH_RESULT_LIMIT = 120;
