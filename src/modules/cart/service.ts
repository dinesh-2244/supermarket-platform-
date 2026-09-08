/**
 * Use-cases for `cart` (D4, arch §10).
 *
 * **The rule the whole module exists for:** every view and every mutation
 * re-reads price, listing and stock from the store and reports what changed.
 * A basket is a list of intentions, not a quote — the shopper's snapshot is
 * only ever compared against, never used, so a price that moved while a tab sat
 * open cannot be honoured and a product that was delisted cannot be bought.
 *
 * **What this module does not do:** it writes `Cart` and `CartItem` rows and
 * nothing else. No `Order`, no `OrderLine`, no `websiteStock`, no `StockLedger`.
 * Adding to a basket reserves nothing; the last unit of something can sit in two
 * shoppers' carts at once, and Phase 4's checkout is where that is resolved
 * under a row lock.
 */
import {
  cartToken as newCartToken,
  ConflictError,
  NotFoundError,
  ValidationError,
  withTransaction,
  type Principal,
  type Tx,
} from '../platform/index';
import { listProducts, type ProductRecord } from '../catalog/index';
import { checkAvailability } from '../inventory/index';
import { getListing, listListings } from '../pricing/index';
import { getStorefrontSettings } from '../stores/index';
import {
  assertQuantity,
  descriptor,
  issuesFor,
  MAX_LINE_QUANTITY,
  noticeFrom,
  parseCartNotice,
  totalsFor,
  type CartLine,
  type CartNotice,
  type CartTotals,
  type ModuleDescriptor,
  type RemovedLine,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type { CartRecord } from './repo';

export interface CartView {
  readonly cartToken: string;
  readonly storeId: string;
  readonly customerId: string | null;
  readonly lines: readonly CartLine[];
  /** Lines this revalidation took out, so the page can say why. */
  readonly removed: readonly RemovedLine[];
  readonly totals: CartTotals;
  /**
   * What the *last mutation's* revalidation found, if it is still fresh.
   *
   * Only ever populated by {@link viewCart}: a mutation's own findings are
   * already in `removed` and `lines[].issues`, and this is how they reach the
   * page that renders afterwards. See {@link CartNotice}.
   */
  readonly notice: CartNotice | null;
}

/**
 * Read a basket, revalidating it first.
 *
 * There is no "just read it" variant on purpose. A cart that could be rendered
 * without revalidation is a cart that will eventually be rendered without
 * revalidation, and the whole guarantee is that what a shopper sees is what the
 * store says right now.
 */
export async function viewCart(principal: Principal, cartToken: string): Promise<CartView | null> {
  const cart = await repo.findCartByToken(cartToken);
  if (cart?.status !== 'ACTIVE') return null;

  return withTransaction(async (tx) => {
    // Read the stored notice *before* revalidating: this revalidation is about
    // to consume the very snapshots the last mutation's notice describes, and a
    // page load must not be what destroys the explanation it is meant to show.
    const locked = await repo.lockCartByToken(tx, cartToken);
    const notice = parseCartNotice(locked?.pendingNoticeJson);
    return { ...(await revalidateInTx(tx, principal, cartToken)), notice };
  });
}

/**
 * The basket for this token, creating one bound to this store if there is none.
 *
 * The token is minted here rather than by the caller so that the cookie and the
 * row are created together; a caller that invented its own token could write a
 * cookie for a cart that does not exist.
 *
 * **`customerId` is applied here, not only at sign-in.** Adoption used to run
 * exclusively from the sign-in action, so a shopper who signed in *before* they
 * had a basket — the ordinary order of events for a returning customer — got a
 * cart with `customerId: null`, outside the one-active-cart rule, until they
 * happened to sign in again (R4). Binding is the same operation wherever it
 * happens, so it happens in one place, under the same customer lock.
 */
export async function ensureCart(
  storeId: string,
  cartToken: string | null,
  customerId: string | null = null,
): Promise<{ cart: repo.CartRecord; created: boolean }> {
  return withTransaction(async (tx) => {
    // Customer before cart, the one lock order this module uses.
    if (customerId !== null) await repo.lockCustomerCarts(tx, customerId);

    if (cartToken !== null) {
      const existing = await repo.lockCartByToken(tx, cartToken);
      if (existing?.status === 'ACTIVE') {
        if (customerId === null || existing.customerId === customerId) {
          return { cart: existing, created: false };
        }
        await bindToCustomer(tx, existing.id, customerId);
        return { cart: { ...existing, customerId }, created: false };
      }
    }

    const cart = await repo.insertCart(tx, { cartToken: newCartToken(), storeId, customerId });
    if (customerId !== null) await abandonOtherCarts(tx, customerId, cart.id);
    return { cart, created: true };
  });
}

/**
 * Make this cart the customer's one active cart.
 *
 * The caller must already hold {@link repo.lockCustomerCarts} for that customer:
 * the rule is about the *set* of their carts, and the other carts it abandons
 * are rows this transaction has not otherwise touched.
 */
async function bindToCustomer(tx: Tx, cartId: string, customerId: string): Promise<void> {
  await abandonOtherCarts(tx, customerId, cartId);
  await repo.setCartCustomer(tx, cartId, customerId);
}

async function abandonOtherCarts(tx: Tx, customerId: string, keepId: string): Promise<void> {
  for (const other of await repo.listActiveCartsForCustomer(customerId, tx)) {
    if (other.id !== keepId) await repo.setCartStatus(tx, other.id, 'ABANDONED');
  }
}

export interface AddItemInput {
  readonly cartToken: string;
  readonly storeId: string;
  readonly productId: string;
  readonly qty: number;
}

/**
 * Put a product in the basket, then revalidate the whole basket.
 *
 * The price written into `unitPriceSnapshotPaise` is the store's price read
 * here, never one the caller supplied: a snapshot taken from the client would
 * make "the price changed" mean "the client said so".
 */
export async function addItem(principal: Principal, input: AddItemInput): Promise<CartView> {
  assertQty(input.qty);

  return withTransaction(async (tx) => {
    const cart = await lockActiveCart(tx, input.cartToken);
    assertSameStore(cart, input.storeId);

    const listing = await requireListing(principal, cart.storeId, input.productId);

    const existing = (await repo.listItems(cart.id, tx)).find(
      (item) => item.productId === input.productId,
    );
    // Adding to a line that is already there tops it up rather than replacing
    // it — that is what a shopper means by pressing "add" twice.
    const qty = Math.min((existing?.qty ?? 0) + input.qty, MAX_LINE_QUANTITY);

    await repo.upsertItem(tx, {
      cartId: cart.id,
      productId: input.productId,
      qty,
      // An existing line **keeps its snapshot**. The snapshot is the price the
      // shopper last saw, and the only thing it is for is being compared against
      // the current one; overwriting it here with the price we just read means
      // the revalidation two lines below compares today's price with today's
      // price and reports no change — so a top-up silently accepted a price move
      // the shopper was never told about (R1).
      unitPriceSnapshotPaise: existing?.unitPriceSnapshotPaise ?? listing.sellingPricePaise,
    });

    return revalidateAndRecord(tx, principal, input.cartToken);
  });
}

/** Set a line to an exact quantity. `0` is not a quantity — use `removeItem`. */
export async function setQuantity(
  principal: Principal,
  input: { cartToken: string; productId: string; qty: number },
): Promise<CartView> {
  assertQty(input.qty);

  return withTransaction(async (tx) => {
    const cart = await lockActiveCart(tx, input.cartToken);
    const item = (await repo.listItems(cart.id, tx)).find(
      (row) => row.productId === input.productId,
    );
    if (item === undefined) {
      throw new NotFoundError('That item is not in your basket', { productId: input.productId });
    }

    await repo.setItemQty(tx, item.id, input.qty);
    return revalidateAndRecord(tx, principal, input.cartToken);
  });
}

export async function removeItem(
  principal: Principal,
  input: { cartToken: string; productId: string },
): Promise<CartView> {
  return withTransaction(async (tx) => {
    const cart = await lockActiveCart(tx, input.cartToken);
    await repo.deleteItemForProduct(tx, cart.id, input.productId);
    return revalidateAndRecord(tx, principal, input.cartToken);
  });
}

/**
 * Re-read everything the basket asserts, and say what changed.
 *
 * Runs inside the caller's transaction, under the cart's row lock, so a basket
 * is never rendered half-revalidated. Four questions per line, in this order:
 *
 * 1. is this product still listed by this store? if not it goes, with a notice;
 * 2. is it still an active product? same;
 * 3. has the price moved? the line uses the **current** price and the snapshot
 *    is brought up to date, so the shopper is told once rather than on every
 *    subsequent page load;
 * 4. is there enough stock? the line is **flagged**, never silently capped.
 */
async function revalidateInTx(tx: Tx, principal: Principal, cartToken: string): Promise<CartView> {
  const cart = await lockActiveCart(tx, cartToken);
  const items = await repo.listItems(cart.id, tx);

  const settings = await getStorefrontSettings(principal, cart.storeId);
  if (items.length === 0) {
    return {
      cartToken,
      storeId: cart.storeId,
      customerId: cart.customerId,
      lines: [],
      removed: [],
      totals: totalsFor([], settings),
      notice: null,
    };
  }

  const productIds = items.map((item) => item.productId);
  const [listings, products, stock] = await Promise.all([
    listListings(principal, {
      storeId: cart.storeId,
      listedOnly: true,
      productIds,
      limit: productIds.length,
    }),
    listProducts(principal, { productIds, limit: productIds.length }),
    checkAvailability(
      principal,
      cart.storeId,
      items.map((item) => ({ productId: item.productId, qty: item.qty })),
    ),
  ]);

  const listingOf = new Map(listings.map((listing) => [listing.productId, listing]));
  const productOf = new Map<string, ProductRecord>(
    products.map((product) => [product.id, product]),
  );

  const lines: CartLine[] = [];
  const removed: RemovedLine[] = [];
  const doomed: string[] = [];

  for (const item of items) {
    const product = productOf.get(item.productId);
    const listing = listingOf.get(item.productId);

    // `listProducts` returns active products only, so a missing one has been
    // discontinued in the master; a missing listing means this store stopped
    // selling it. Different causes, different words, same outcome.
    if (product === undefined || listing === undefined) {
      doomed.push(item.id);
      removed.push({
        productId: item.productId,
        name: product?.name ?? 'An item',
        reason: product === undefined ? 'discontinued' : 'unlisted',
      });
      continue;
    }

    const available = stock.get(item.productId)?.available ?? 0;
    const issues = issuesFor({
      snapshotPricePaise: item.unitPriceSnapshotPaise,
      currentPricePaise: listing.sellingPricePaise,
      qty: item.qty,
      available,
    });

    if (item.unitPriceSnapshotPaise !== listing.sellingPricePaise) {
      // Told once. Leaving the snapshot stale would repeat "the price changed"
      // on every page load until the shopper checked out.
      await repo.setItemSnapshot(tx, item.id, listing.sellingPricePaise);
    }

    lines.push({
      productId: product.id,
      name: product.name,
      slug: product.slug,
      brand: product.brand,
      packSize: product.packSize,
      qty: item.qty,
      // The authoritative price, not the snapshot the client last saw.
      unitPricePaise: listing.sellingPricePaise,
      mrpPaise: listing.mrpPaise,
      lineTotalPaise: listing.sellingPricePaise * item.qty,
      issues,
    });
  }

  await repo.deleteItems(tx, doomed);

  return {
    cartToken,
    storeId: cart.storeId,
    customerId: cart.customerId,
    lines,
    removed,
    totals: totalsFor(lines, settings),
    notice: null,
  };
}

/**
 * Revalidate, and record what that found on the cart itself.
 *
 * Every mutation goes through here rather than through `revalidateInTx`
 * directly. The record is written in the same transaction as the change it
 * describes, so it can be neither partial nor lost — which a response header
 * carrying an unbounded list of affected lines could be, and was (R1).
 *
 * A mutation that finds nothing writes `null`, because leaving the previous
 * mutation's notice standing would attribute it to this one.
 */
async function revalidateAndRecord(
  tx: Tx,
  principal: Principal,
  cartToken: string,
): Promise<CartView> {
  const view = await revalidateInTx(tx, principal, cartToken);
  const cart = await repo.lockCartByToken(tx, cartToken);
  if (cart !== null) await repo.setPendingNotice(tx, cart.id, noticeFrom(view));
  return view;
}

/**
 * Rebuild a basket against a different store (D5).
 *
 * Lines are **replaced, not merged**: the new store's prices, listings and stock
 * are a different set of facts, and a merged basket would carry the old store's
 * snapshot prices for products the new store sells at a different price. A line
 * carries over when the new store lists it and has any stock; otherwise it is
 * dropped and named.
 *
 * One transaction, so the cart never exists half-moved between two stores.
 */
export async function rebuildForStore(
  principal: Principal,
  cartToken: string,
  storeId: string,
): Promise<{ view: CartView; carried: readonly string[]; dropped: readonly string[] }> {
  return withTransaction(async (tx) => {
    const cart = await lockActiveCart(tx, cartToken);
    if (cart.storeId === storeId) {
      // Same store: nothing to rebuild. A revalidation still runs, because the
      // prices may have moved for entirely unrelated reasons.
      return {
        view: await revalidateAndRecord(tx, principal, cartToken),
        carried: [],
        dropped: [],
      };
    }

    const items = await repo.listItems(cart.id, tx);
    const productIds = items.map((item) => item.productId);

    const [listings, products, stock] = await Promise.all([
      productIds.length === 0
        ? Promise.resolve([])
        : listListings(principal, {
            storeId,
            listedOnly: true,
            productIds,
            limit: productIds.length,
          }),
      productIds.length === 0
        ? Promise.resolve([])
        : listProducts(principal, { productIds, limit: productIds.length }),
      productIds.length === 0
        ? Promise.resolve(new Map<string, { available: number }>())
        : checkAvailability(
            principal,
            storeId,
            items.map((item) => ({ productId: item.productId, qty: item.qty })),
          ),
    ]);

    const listingOf = new Map(listings.map((listing) => [listing.productId, listing]));
    const productOf = new Map<string, ProductRecord>(
      products.map((product) => [product.id, product]),
    );

    const carried: string[] = [];
    const dropped: string[] = [];

    await repo.setCartStore(tx, cart.id, storeId);
    await repo.deleteItems(
      tx,
      items.map((item) => item.id),
    );

    for (const item of items) {
      const product = productOf.get(item.productId);
      const listing = listingOf.get(item.productId);
      const available = stock.get(item.productId)?.available ?? 0;

      if (product === undefined || listing === undefined || available <= 0) {
        dropped.push(product?.name ?? 'An item');
        continue;
      }

      await repo.upsertItem(tx, {
        cartId: cart.id,
        productId: item.productId,
        qty: item.qty,
        // Re-priced at the new store's price, which is the point of a rebuild.
        unitPriceSnapshotPaise: listing.sellingPricePaise,
      });
      carried.push(product.name);
    }

    return { view: await revalidateAndRecord(tx, principal, cartToken), carried, dropped };
  });
}

/**
 * Bind a guest basket to a customer who has just signed in (D6).
 *
 * **The device's basket wins.** If the customer already had an active cart
 * elsewhere, it is marked `ABANDONED` rather than merged: the shopper is looking
 * at *this* basket right now, and silently folding in items chosen on another
 * device days ago produces a basket they did not assemble. The abandoned cart is
 * not deleted, so nothing is lost that a support conversation could recover.
 */
export async function adoptCart(cartToken: string, customerId: string): Promise<void> {
  await withTransaction(async (tx) => {
    // Customer first, then cart — one order everywhere, so two adoptions can
    // queue but never deadlock against each other.
    await repo.lockCustomerCarts(tx, customerId);

    const cart = await repo.lockCartByToken(tx, cartToken);
    if (cart?.status !== 'ACTIVE') return;

    // No early return for a cart this customer already owns. It used to look
    // like a harmless no-op and was the reason a customer left holding two
    // active carts could never be repaired: signing in again on the device
    // whose basket should win did nothing at all (R3).
    await bindToCustomer(tx, cart.id, customerId);
  });
}

/** How many items are in this basket, for the header. Cheap, and never null. */
export async function cartItemCount(cartToken: string | null): Promise<number> {
  if (cartToken === null) return 0;
  const cart = await repo.findCartByToken(cartToken);
  if (cart?.status !== 'ACTIVE') return 0;
  const items = await repo.listItems(cart.id);
  return items.reduce((sum, item) => sum + item.qty, 0);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

async function lockActiveCart(tx: Tx, cartToken: string): Promise<repo.CartRecord> {
  const cart = await repo.lockCartByToken(tx, cartToken);
  if (cart === null) throw new NotFoundError('No basket for that token', {});
  if (cart.status !== 'ACTIVE') {
    throw new ConflictError('That basket is no longer active', { status: cart.status });
  }
  return cart;
}

/**
 * A basket belongs to exactly one store.
 *
 * The UI never offers another store's product, but the service must not trust
 * that: a crafted form post is the whole reason this check exists (D4).
 */
function assertSameStore(cart: repo.CartRecord, storeId: string): void {
  if (cart.storeId !== storeId) {
    throw new ConflictError(
      'Your basket belongs to a different shop — change your delivery area to move it',
      { cartStoreId: cart.storeId, requestedStoreId: storeId },
    );
  }
}

/**
 * The product must be listed by *this* store, checked with the shopper's own
 * principal — so the store scoping is the same `allowedStoreIds` rule as
 * everywhere else, and a product the store does not sell cannot be added at any
 * price.
 */
async function requireListing(
  principal: Principal,
  storeId: string,
  productId: string,
): Promise<{ sellingPricePaise: number }> {
  // By key, not by scanning a page of listings: a store with more listings than
  // whatever limit that page used would refuse to sell its own products (R6).
  const listing = await getListing(principal, storeId, productId);
  if (listing?.isListed !== true) {
    throw new NotFoundError('That product is not available at your shop', { productId });
  }
  return listing;
}

/** `assertQuantity` throws `RangeError`; callers want a domain error. */
function assertQty(qty: number): void {
  try {
    assertQuantity(qty);
  } catch (error) {
    throw new ValidationError(error instanceof Error ? error.message : 'Invalid quantity', { qty });
  }
}
