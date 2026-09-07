/**
 * Deterministic test factories (§19).
 *
 * Every builder takes an optional `PrismaClient`/transaction handle and a partial
 * override, and returns the persisted row. Unique values come from a per-process
 * counter rather than randomness, so a failing test is reproducible from its
 * output.
 */
import type { Prisma, PrismaClient } from '@prisma/client';

export type Db = PrismaClient | Prisma.TransactionClient;

let sequence = 0;

/** Monotonic, zero-padded suffix used to keep unique columns unique. */
export function nextSeq(): string {
  sequence += 1;
  return String(sequence).padStart(6, '0');
}

export function resetSequence(): void {
  sequence = 0;
}

export async function createStore(
  db: Db,
  overrides: Partial<Prisma.StoreUncheckedCreateInput> = {},
): Promise<Prisma.StoreGetPayload<object>> {
  const seq = nextSeq();
  return db.store.create({
    data: {
      code: `T${seq}`,
      name: `Test Store ${seq}`,
      addressJson: { line1: '1 Test Road', city: 'Bengaluru', pincode: '560001' },
      ...overrides,
    },
  });
}

export async function createStoreSettings(
  db: Db,
  storeId: string,
  overrides: Partial<Prisma.StoreSettingsUncheckedCreateInput> = {},
): Promise<Prisma.StoreSettingsGetPayload<object>> {
  return db.storeSettings.create({
    data: {
      storeId,
      deliveryFeePaise: 3_000,
      minOrderPaise: 20_000,
      ...overrides,
    },
  });
}

export async function createCategory(
  db: Db,
  overrides: Partial<Prisma.CategoryUncheckedCreateInput> = {},
): Promise<Prisma.CategoryGetPayload<object>> {
  const seq = nextSeq();
  return db.category.create({
    data: { name: `Category ${seq}`, slug: `category-${seq}`, ...overrides },
  });
}

export async function createProduct(
  db: Db,
  overrides: Partial<Prisma.ProductUncheckedCreateInput> = {},
): Promise<Prisma.ProductGetPayload<object>> {
  const seq = nextSeq();
  const categoryId = overrides.categoryId ?? (await createCategory(db)).id;
  return db.product.create({
    data: {
      sku: `SKU-${seq}`,
      name: `Test Product ${seq}`,
      slug: `test-product-${seq}`,
      packSize: '1 kg',
      ...overrides,
      categoryId,
    },
  });
}

export async function createStoreProduct(
  db: Db,
  storeId: string,
  productId: string,
  overrides: Partial<Prisma.StoreProductUncheckedCreateInput> = {},
): Promise<Prisma.StoreProductGetPayload<object>> {
  return db.storeProduct.create({
    data: {
      storeId,
      productId,
      mrpPaise: 10_000,
      sellingPricePaise: 9_500,
      listedAt: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    },
  });
}

export async function createInventoryItem(
  db: Db,
  storeId: string,
  productId: string,
  overrides: Partial<Prisma.InventoryItemUncheckedCreateInput> = {},
): Promise<Prisma.InventoryItemGetPayload<object>> {
  return db.inventoryItem.create({
    data: { storeId, productId, websiteStock: 25, ...overrides },
  });
}

export async function createUser(
  db: Db,
  overrides: Partial<Prisma.UserUncheckedCreateInput> = {},
): Promise<Prisma.UserGetPayload<object>> {
  const seq = nextSeq();
  return db.user.create({
    data: {
      email: `user-${seq}@test.local`,
      // A fixed non-secret placeholder: factories never hash, so tests stay fast.
      passwordHash: '$argon2id$test-placeholder',
      name: `Test User ${seq}`,
      role: 'STORE_STAFF',
      ...overrides,
    },
  });
}

export async function createCustomer(
  db: Db,
  overrides: Partial<Prisma.CustomerUncheckedCreateInput> = {},
): Promise<Prisma.CustomerGetPayload<object>> {
  const seq = nextSeq();
  return db.customer.create({
    data: { phone: `9${seq.padStart(9, '0')}`, name: `Test Customer ${seq}`, ...overrides },
  });
}

export async function createDeliveryZone(
  db: Db,
  storeId: string,
  overrides: Partial<Prisma.DeliveryZoneUncheckedCreateInput> = {},
): Promise<Prisma.DeliveryZoneGetPayload<object>> {
  return db.deliveryZone.create({
    data: { storeId, name: `Zone ${nextSeq()}`, ...overrides },
  });
}

export async function createDeliveryArea(
  db: Db,
  zoneId: string,
  overrides: Partial<Prisma.DeliveryAreaUncheckedCreateInput> = {},
): Promise<Prisma.DeliveryAreaGetPayload<object>> {
  return db.deliveryArea.create({
    data: { zoneId, name: `Area ${nextSeq()}`, pincode: '560001', ...overrides },
  });
}

export async function createCustomerAddress(
  db: Db,
  customerId: string,
  overrides: Partial<Prisma.CustomerAddressUncheckedCreateInput> = {},
): Promise<Prisma.CustomerAddressGetPayload<object>> {
  return db.customerAddress.create({
    data: { customerId, line1: `${nextSeq()} Test Street`, pincode: '560001', ...overrides },
  });
}

export async function createCart(
  db: Db,
  storeId: string,
  overrides: Partial<Prisma.CartUncheckedCreateInput> = {},
): Promise<Prisma.CartGetPayload<object>> {
  return db.cart.create({
    data: { storeId, cartToken: `c_test_${nextSeq()}`, ...overrides },
  });
}

export async function createOrder(
  db: Db,
  storeId: string,
  customerId: string,
  overrides: Partial<Prisma.OrderUncheckedCreateInput> = {},
): Promise<Prisma.OrderGetPayload<object>> {
  const seq = nextSeq();
  const slotStart = new Date('2026-01-02T10:00:00Z');
  return db.order.create({
    data: {
      orderNumber: `ORD-${seq}`,
      trackingToken: `t_test_${seq}`,
      storeId,
      customerId,
      contactNameSnapshot: 'Test Customer',
      contactPhoneSnapshot: '9000000000',
      deliveryAddressSnapshotJson: { line1: '1 Test Street', pincode: '560001' },
      deliverySlotStart: slotStart,
      deliverySlotEnd: new Date(slotStart.getTime() + 60 * 60 * 1000),
      paymentMethod: 'COD',
      subtotalPaise: 50_000,
      deliveryFeePaise: 3_000,
      estimatedTotalPaise: 53_000,
      ...overrides,
    },
  });
}

/**
 * A store with settings, one listed product and stock — the smallest fixture a
 * cart/checkout test needs.
 */
export async function createStoreWithProduct(
  db: Db,
  options: { websiteStock?: number; sellingPricePaise?: number } = {},
): Promise<{
  store: Prisma.StoreGetPayload<object>;
  product: Prisma.ProductGetPayload<object>;
  storeProduct: Prisma.StoreProductGetPayload<object>;
  inventoryItem: Prisma.InventoryItemGetPayload<object>;
}> {
  const store = await createStore(db);
  await createStoreSettings(db, store.id);
  const product = await createProduct(db);
  const storeProduct = await createStoreProduct(db, store.id, product.id, {
    ...(options.sellingPricePaise !== undefined
      ? { sellingPricePaise: options.sellingPricePaise }
      : {}),
  });
  const inventoryItem = await createInventoryItem(db, store.id, product.id, {
    ...(options.websiteStock !== undefined ? { websiteStock: options.websiteStock } : {}),
  });
  return { store, product, storeProduct, inventoryItem };
}
