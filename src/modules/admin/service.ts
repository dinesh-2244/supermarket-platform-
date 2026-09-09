/**
 * Read models for the back office (D7).
 *
 * **No domain rules live here.** Every function is a composition of calls into
 * the owning modules through their `index.ts`, which is what keeps `admin` a
 * BFF rather than a second place where business logic accumulates. Each of those
 * calls carries the principal, so authorization and store scoping happen in the
 * module that owns the data — never in this layer and never in a template.
 */
import { allowedStoreIds, assertAuthorized, type Principal } from '../platform/index';
import { listCategories, listProducts, type ProductRecord } from '../catalog/index';
import { listStores, type StoreRecord } from '../stores/index';
import { discountBp, listListings, type StoreProductRecord } from '../pricing/index';
import { listLowStock, listStock, type InventoryRecord } from '../inventory/index';
import {
  queueForStore,
  staffOrder,
  type OrderStatus,
  type QueueRow,
  type StaffOrderRow,
} from '../orders/index';
import { descriptor, type ModuleDescriptor } from './domain/index';
import * as repo from './repo';

export type { AuditEntryRecord, AuditQuery } from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export interface ListingRow {
  readonly listing: StoreProductRecord;
  readonly product: ProductRecord | undefined;
  readonly discountBp: number;
}

/** Listings joined to the shared master, for the prices screen. */
export async function listingRows(
  principal: Principal,
  storeId: string,
): Promise<readonly ListingRow[]> {
  const [listings, products] = await Promise.all([
    listListings(principal, { storeId }),
    listProducts(principal, { includeInactive: true, limit: 500 }),
  ]);
  const byId = new Map(products.map((product) => [product.id, product]));

  return listings.map((listing) => ({
    listing,
    product: byId.get(listing.productId),
    discountBp: discountBp(listing),
  }));
}

export interface StockRow {
  readonly item: InventoryRecord;
  readonly product: ProductRecord | undefined;
  readonly sellingPricePaise: number | undefined;
}

/** Stock joined to the master and the store's price, for the inventory screen. */
export async function stockRows(
  principal: Principal,
  storeId: string,
): Promise<readonly StockRow[]> {
  const [items, products, listings] = await Promise.all([
    listStock(principal, { storeId }),
    listProducts(principal, { includeInactive: true, limit: 500 }),
    listListings(principal, { storeId }),
  ]);
  const byId = new Map(products.map((product) => [product.id, product]));
  const priceByProduct = new Map(listings.map((l) => [l.productId, l.sellingPricePaise]));

  return items.map((item) => ({
    item,
    product: byId.get(item.productId),
    sellingPricePaise: priceByProduct.get(item.productId),
  }));
}

/**
 * The statuses the queue shows by default: everything a store still has to act
 * on. Delivered, closed and cancelled orders are history and would bury the
 * work — they are still reachable by asking for them.
 */
export const ACTIONABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'PLACED',
  'ACCEPTED',
  'PICKING',
  'PICKED',
  'BILLED_IN_POS',
  'PACKED',
  'OUT_FOR_DELIVERY',
  'DELIVERY_FAILED',
];

export interface OrderQueue {
  readonly storeId: string;
  readonly rows: readonly QueueRow[];
  readonly showingAll: boolean;
}

/**
 * The back-office order queue — a thin read model over `orders`, which is all
 * `admin` is allowed to be (§4: no domain rules here).
 */
export async function orderQueue(
  principal: Principal,
  storeId: string,
  options: { all?: boolean } = {},
): Promise<OrderQueue> {
  const showingAll = options.all === true;
  const rows = await queueForStore(principal, storeId, {
    ...(showingAll ? {} : { statuses: ACTIONABLE_ORDER_STATUSES }),
  });
  return { storeId, rows, showingAll };
}

/** One order for the detail screen, or `null` if it is not this staff's to see. */
export async function orderDetail(
  principal: Principal,
  orderId: string,
): Promise<StaffOrderRow | null> {
  return staffOrder(principal, orderId);
}

export interface Overview {
  readonly stores: readonly StoreRecord[];
  readonly storeId: string | null;
  readonly productCount: number;
  readonly categoryCount: number;
  readonly listedCount: number;
  readonly lowStock: { threshold: number; items: readonly InventoryRecord[] };
}

/** The landing screen. */
export async function overview(principal: Principal, storeId: string | null): Promise<Overview> {
  const stores = await listStores(principal);
  const selected = storeId ?? stores[0]?.id ?? null;

  const [products, categories] = await Promise.all([
    listProducts(principal, { limit: 500 }),
    listCategories(principal),
  ]);

  const listed =
    selected === null ? [] : await listListings(principal, { storeId: selected, listedOnly: true });
  const lowStock =
    selected === null
      ? { threshold: 0, items: [] as readonly InventoryRecord[] }
      : await listLowStock(principal, selected);

  return {
    stores,
    storeId: selected,
    productCount: products.length,
    categoryCount: categories.length,
    listedCount: listed.length,
    lowStock,
  };
}

/**
 * The store a screen should show.
 *
 * A scoped principal is pinned to their own store whatever the query string
 * says — the request cannot widen access, and picking the store here rather
 * than trusting the URL is what stops a hand-edited `?store=` reaching another
 * store's screen. (The module services refuse it too; this makes the UI honest
 * rather than merely safe.)
 */
export function resolveStoreId(
  principal: Principal,
  requested: string | undefined,
  available: readonly StoreRecord[],
): string | null {
  if (principal.kind === 'user' && principal.role !== 'SUPER_ADMIN') {
    return principal.storeId;
  }
  if (requested !== undefined && available.some((store) => store.id === requested)) {
    return requested;
  }
  return available[0]?.id ?? null;
}

/**
 * The generic sensitive-mutation trail (§21), for the audit viewer.
 *
 * Scoped by the **immutable `storeId` stamped on each entry**, filtered in SQL
 * before the limit. The previous version narrowed by "users currently assigned
 * to my store" and filtered after the query, which was wrong twice over: moving
 * a manager between stores retro-assigned their entire history to the new store,
 * and a busy second store could push every visible row out of the fetched page.
 *
 * Read-only; Phase 2 has no path that updates or deletes an entry.
 */
export async function auditEntries(
  principal: Principal,
  query: repo.AuditQuery = {},
): Promise<readonly repo.AuditEntryRecord[]> {
  assertAuthorized(principal, 'audit-log:read', {
    type: 'AuditLog',
    storeId: principal.kind === 'user' ? principal.storeId : null,
  });

  return repo.listAuditEntries({ ...query, storeIds: allowedStoreIds(principal) });
}
