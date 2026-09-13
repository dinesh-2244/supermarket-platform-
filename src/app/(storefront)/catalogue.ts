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
 * Composing one store's shop window out of three modules (D2, D3).
 *
 * The catalogue a shopper sees is not any one module's data: the *product* is
 * the shared global master (`catalog`), the *price and whether it is sold here
 * at all* belong to the store (`pricing`), and the *availability* to that
 * store's inventory. Architecture §4 keeps those three apart, so the join
 * happens here, above all of them, rather than one module reaching into
 * another's tables.
 */

/** One product as the storefront shows it: master data, this store's terms, and photography. */
export interface ShopItem {
  readonly product: ProductRecord;
  readonly sellingPricePaise: number;
  readonly mrpPaise: number;
  readonly availability: AvailabilityRecord;
  readonly imageUrl?: string | null;
  readonly imageAlt?: string | null;
  readonly categorySlug?: string | null;
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
 */
async function listedProductIds(principal: Principal, storeId: string): Promise<readonly string[]> {
  return listListedProductIds(principal, storeId);
}

/**
 * This store's prices for the products on the page in front of the shopper.
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
  const [availability, priceOf, imagesList, categories] = await Promise.all([
    availabilityFor(principal, storeId, pageIds),
    pricesFor(principal, storeId, pageIds),
    Promise.all(pageIds.map((id) => listProductImages(principal, id))),
    listCategories(principal),
  ]);

  const categorySlugMap = new Map(categories.map((c) => [c.id, c.slug]));
  const imageMap = new Map(
    pageIds.map((id, index) => {
      const img = imagesList[index]?.[0];
      return [id, img ? { url: img.url, alt: img.alt } : null];
    }),
  );

  return {
    items: products.flatMap((product) =>
      toShopItem(product, priceOf, availability, imageMap, categorySlugMap),
    ),
    total,
    page: safePage,
    pageCount,
  };
}

/**
 * A product only becomes a `ShopItem` if this store prices it.
 */
function toShopItem(
  product: ProductRecord,
  priceOf: ReadonlyMap<string, ShopPrice>,
  availability: ReadonlyMap<string, AvailabilityRecord>,
  imageMap?: ReadonlyMap<string, { url: string; alt: string | null } | null>,
  categorySlugMap?: ReadonlyMap<string, string>,
): ShopItem[] {
  const price = priceOf.get(product.id);
  const stock = availability.get(product.id);
  if (price === undefined || stock === undefined) return [];
  const img = imageMap?.get(product.id);
  const categorySlug = categorySlugMap?.get(product.categoryId) ?? null;
  return [
    {
      product,
      ...price,
      availability: stock,
      imageUrl: img?.url ?? null,
      imageAlt: img?.alt ?? null,
      categorySlug,
    },
  ];
}

export interface ProductPage extends ShopItem {
  readonly images: readonly { id: string; url: string; alt: string | null }[];
  readonly trail: readonly CategoryRecord[];
}

/**
 * One product page, or `null` when this store does not sell it.
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

  const listing = await getListing(principal, storeId, product.id);
  if (listing?.isListed !== true) return null;

  const [availability, images, categories] = await Promise.all([
    availabilityFor(principal, storeId, [product.id]),
    listProductImages(principal, product.id),
    listCategories(principal),
  ]);

  const stock = availability.get(product.id);
  if (stock === undefined) return null;

  const trail = categoryTrail(categories, product.categoryId);

  return {
    product,
    sellingPricePaise: listing.sellingPricePaise,
    mrpPaise: listing.mrpPaise,
    availability: stock,
    imageUrl: images[0]?.url ?? null,
    imageAlt: images[0]?.alt ?? null,
    categorySlug: trail[trail.length - 1]?.slug ?? trail[0]?.slug ?? null,
    images: images.map((image) => ({ id: image.id, url: image.url, alt: image.alt })),
    trail,
  };
}

/**
 * The categories this store actually has something in.
 */
export async function shopCategories(
  context: StoreContext,
  customerId: string | null = null,
): Promise<readonly CategoryRecord[]> {
  const principal = storefrontPrincipal(context, customerId);
  const storeId = context.serviceability.storeId;

  const [categories, ids] = await Promise.all([
    listCategories(principal),
    listedProductIds(principal, storeId),
  ]);
  if (ids.length === 0) return [];

  const stocked = new Set(
    (await listProducts(principal, { productIds: ids, limit: ids.length })).map(
      (product) => product.categoryId,
    ),
  );

  return categories.filter(
    (category) =>
      category.parentId === null &&
      descendantCategoryIds(categories, category.id).some((id) => stocked.has(id)),
  );
}

/**
 * Search this store's shelves (D3).
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

  const pageCount = Math.max(1, Math.ceil(hits.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const window = hits.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const windowIds = window.map((hit) => hit.id);
  const [availability, priceOf, imagesList, categories] = await Promise.all([
    availabilityFor(principal, storeId, windowIds),
    pricesFor(principal, storeId, windowIds),
    Promise.all(windowIds.map((id) => listProductImages(principal, id))),
    listCategories(principal),
  ]);

  const categorySlugMap = new Map(categories.map((c) => [c.id, c.slug]));
  const imageMap = new Map(
    windowIds.map((id, index) => {
      const img = imagesList[index]?.[0];
      return [id, img ? { url: img.url, alt: img.alt } : null];
    }),
  );

  return {
    items: window.flatMap((hit) =>
      toShopItem(hit, priceOf, availability, imageMap, categorySlugMap),
    ),
    total: hits.length,
    page: safePage,
    pageCount,
  };
}

export const SEARCH_RESULT_LIMIT = 120;
