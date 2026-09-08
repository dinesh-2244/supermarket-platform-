/**
 * Prisma / SQL access for `cart`. Private to this module: nothing outside
 * `src/modules/cart` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * Every write in here touches `Cart` or `CartItem` and nothing else. There is
 * deliberately no helper that can reach `InventoryItem`, `StockLedger`, `Order`
 * or `OrderLine`: Phase 3's headline invariant is that a basket moves no stock
 * and creates no order, and the cheapest way to hold it is for this file to
 * have no way of doing so.
 */
import {
  advisoryXactLock,
  getPrisma,
  LOCK_NAMESPACE,
  type DbExecutor,
  type Tx,
} from '../platform/index';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

/**
 * The executor to run a cart *write* on.
 *
 * Takes the branded `Tx` that only `withTransaction` can mint. A revalidation
 * removes lines, rewrites price snapshots and reads the result; doing that in
 * three separate statements would let a shopper see a basket that is half
 * revalidated, which is exactly the sort of "it was fine when I looked" the
 * cart exists to prevent.
 */
export function cartExecutor(tx: Tx): Tx {
  return tx;
}

export interface CartRecord {
  readonly id: string;
  readonly cartToken: string;
  readonly customerId: string | null;
  readonly storeId: string;
  readonly status: 'ACTIVE' | 'CONVERTED' | 'ABANDONED';
}

export interface CartItemRecord {
  readonly id: string;
  readonly cartId: string;
  readonly productId: string;
  readonly qty: number;
  readonly unitPriceSnapshotPaise: number;
}

const cartSelect = {
  id: true,
  cartToken: true,
  customerId: true,
  storeId: true,
  status: true,
} as const;

export async function findCartByToken(
  cartToken: string,
  db?: DbExecutor,
): Promise<CartRecord | null> {
  return executor(db).cart.findUnique({ where: { cartToken }, select: cartSelect });
}

/**
 * The cart row for a token, locked for the rest of the transaction.
 *
 * Two requests from the same device — a double-tapped "add", a page load racing
 * a quantity change — would otherwise both revalidate the same basket and both
 * write their view of it. Raw SQL because Prisma has no `FOR UPDATE`.
 */
export async function lockCartByToken(tx: Tx, cartToken: string): Promise<CartRecord | null> {
  const rows = await cartExecutor(tx).$queryRaw<CartRecord[]>`
    SELECT "id", "cartToken", "customerId", "storeId", "status"
    FROM "Cart"
    WHERE "cartToken" = ${cartToken}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

export async function insertCart(
  tx: Tx,
  row: { cartToken: string; storeId: string; customerId: string | null },
): Promise<CartRecord> {
  return cartExecutor(tx).cart.create({
    data: { cartToken: row.cartToken, storeId: row.storeId, customerId: row.customerId },
    select: cartSelect,
  });
}

export async function listItems(
  cartId: string,
  db?: DbExecutor,
): Promise<readonly CartItemRecord[]> {
  return executor(db).cartItem.findMany({
    where: { cartId },
    orderBy: { addedAt: 'asc' },
    select: { id: true, cartId: true, productId: true, qty: true, unitPriceSnapshotPaise: true },
  });
}

/**
 * Add a product, or add to it if it is already there.
 *
 * `upsert` on `(cartId, productId)` rather than a second line: two lines for the
 * same product would each carry their own snapshot and their own stock check,
 * and the shopper would have no way to reconcile them.
 */
export async function upsertItem(
  tx: Tx,
  row: { cartId: string; productId: string; qty: number; unitPriceSnapshotPaise: number },
): Promise<CartItemRecord> {
  return cartExecutor(tx).cartItem.upsert({
    where: { cartId_productId: { cartId: row.cartId, productId: row.productId } },
    update: { qty: row.qty, unitPriceSnapshotPaise: row.unitPriceSnapshotPaise },
    create: { ...row },
    select: { id: true, cartId: true, productId: true, qty: true, unitPriceSnapshotPaise: true },
  });
}

export async function setItemQty(tx: Tx, itemId: string, qty: number): Promise<void> {
  await cartExecutor(tx).cartItem.update({ where: { id: itemId }, data: { qty } });
}

export async function setItemSnapshot(
  tx: Tx,
  itemId: string,
  unitPriceSnapshotPaise: number,
): Promise<void> {
  await cartExecutor(tx).cartItem.update({
    where: { id: itemId },
    data: { unitPriceSnapshotPaise },
  });
}

export async function deleteItems(tx: Tx, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await cartExecutor(tx).cartItem.deleteMany({ where: { id: { in: [...itemIds] } } });
}

export async function deleteItemForProduct(
  tx: Tx,
  cartId: string,
  productId: string,
): Promise<void> {
  await cartExecutor(tx).cartItem.deleteMany({ where: { cartId, productId } });
}

/** Move a cart to another store (D5). The caller replaces the lines in the same tx. */
export async function setCartStore(tx: Tx, cartId: string, storeId: string): Promise<void> {
  await cartExecutor(tx).cart.update({ where: { id: cartId }, data: { storeId } });
}

/** Bind a guest cart to a customer once they sign in (D6). */
export async function setCartCustomer(tx: Tx, cartId: string, customerId: string): Promise<void> {
  await cartExecutor(tx).cart.update({ where: { id: cartId }, data: { customerId } });
}

export async function setCartStatus(
  tx: Tx,
  cartId: string,
  status: 'ACTIVE' | 'CONVERTED' | 'ABANDONED',
): Promise<void> {
  await cartExecutor(tx).cart.update({ where: { id: cartId }, data: { status } });
}

/**
 * Serialise this shopper's "at most one active cart" rule.
 *
 * Taken **before** the active-cart list is read. Locking each cart row protects
 * each cart and nothing about the relationship between them: two devices
 * adopting two different carts lock two different rows, each reads the other's
 * adoption as not yet done, and both commit an active cart for one customer
 * (R3). The lock therefore has to be on the customer, who is the thing the rule
 * is actually about.
 */
export async function lockCustomerCarts(tx: Tx, customerId: string): Promise<void> {
  await advisoryXactLock(tx, LOCK_NAMESPACE.customerCarts, customerId);
}

/** A customer's other active carts — for the sign-in multi-cart rule (D6). */
export async function listActiveCartsForCustomer(
  customerId: string,
  db?: DbExecutor,
): Promise<readonly CartRecord[]> {
  return executor(db).cart.findMany({
    where: { customerId, status: 'ACTIVE' },
    select: cartSelect,
    orderBy: { updatedAt: 'desc' },
  });
}
