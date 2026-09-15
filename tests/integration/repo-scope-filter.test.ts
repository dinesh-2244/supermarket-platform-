import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, type Principal } from '@/modules/platform';
import { countByStatusAndVariance, listForPrincipal as listOrders } from '@/modules/orders/repo';
import { listImportRuns, listItems, listLedger, listLowStock } from '@/modules/inventory/repo';
import { listListedProductIds, listListings } from '@/modules/pricing/repo';
import { listZones } from '@/modules/stores/repo';
import {
  createCategory,
  createCustomer,
  createDeliveryZone,
  createInventoryItem,
  createProduct,
  createStore,
  createStoreProduct,
  createUser,
} from '../factories/index';

/**
 * The repository scope filter must constrain results **on its own**.
 *
 * Every store-bound repository read carries `storeScopeFilter(principal)` as
 * its "second line": the service authorizes first, and the query refuses to
 * return another store's rows even if a caller forgot to. That line was
 * silently off wherever the filter was *spread* next to a literal `storeId`
 * key — both produce a `storeId` condition, and the second spread wins. These
 * tests call the repositories directly, as a manager of store A asking for
 * store B, and expect nothing back; the services' own checks are bypassed on
 * purpose, because they are exactly what was hiding the defect.
 */
const prisma = getPrisma();

const userIds: string[] = [];
let storeA: string;
let storeB: string;
let categoryId: string;
let productId: string;
let customerId: string;
let managerA: Principal;
let superAdmin: Principal;

beforeAll(async () => {
  storeA = (await createStore(prisma)).id;
  storeB = (await createStore(prisma)).id;
  categoryId = (await createCategory(prisma)).id;
  productId = (await createProduct(prisma, { categoryId })).id;
  customerId = (await createCustomer(prisma)).id;

  const mA = await createUser(prisma, { role: 'STORE_MANAGER', storeId: storeA });
  const sup = await createUser(prisma, { role: 'SUPER_ADMIN', storeId: null });
  userIds.push(mA.id, sup.id);
  managerA = { kind: 'user', userId: mA.id, role: 'STORE_MANAGER', storeId: storeA };
  superAdmin = { kind: 'user', userId: sup.id, role: 'SUPER_ADMIN', storeId: null };

  // One row of everything, all in store B — the store manager A must not see.
  await createStoreProduct(prisma, storeB, productId, { sellingPricePaise: 1_000 });
  await createInventoryItem(prisma, storeB, productId, { websiteStock: 0 });
  await createDeliveryZone(prisma, storeB);
  await prisma.stockLedger.create({
    data: {
      storeId: storeB,
      productId,
      delta: 5,
      reason: 'MANUAL_ADJUST',
      balanceAfter: 5,
      actorType: 'USER',
      actorId: sup.id,
    },
  });
  await prisma.inventoryImport.create({
    data: { storeId: storeB, filename: 'scope.csv', mode: 'replace', outcome: 'applied' },
  });
  await prisma.order.create({
    data: {
      orderNumber: `SCP${Date.now().toString(36)}`,
      trackingToken: `scp-${Date.now()}`,
      customerId,
      storeId: storeB,
      contactNameSnapshot: 'Scope Tester',
      contactPhoneSnapshot: '9000000999',
      deliveryAddressSnapshotJson: { locality: 'Indiranagar' },
      deliverySlotStart: new Date('2026-12-03T10:30:00Z'),
      deliverySlotEnd: new Date('2026-12-03T11:30:00Z'),
      paymentMethod: 'COD',
      subtotalPaise: 1_000,
      deliveryFeePaise: 0,
      estimatedTotalPaise: 1_000,
    },
  });
});

afterAll(async () => {
  const stores = [storeA, storeB];
  await prisma.order.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.inventoryImport.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.stockLedger.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.inventoryItem.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.storeProduct.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.deliveryZone.deleteMany({ where: { storeId: { in: stores } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.store.deleteMany({ where: { id: { in: stores } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

describe('a store-A manager asking the repository for store B gets nothing', () => {
  it('orders.listForPrincipal', async () => {
    expect(await listOrders(prisma, managerA, { storeId: storeB })).toEqual([]);
    expect(await listOrders(prisma, superAdmin, { storeId: storeB })).toHaveLength(1);
  });

  it('orders.countByStatusAndVariance', async () => {
    expect(await countByStatusAndVariance(prisma, managerA, storeB)).toEqual([]);
    expect(await countByStatusAndVariance(prisma, superAdmin, storeB)).toHaveLength(1);
  });

  it('inventory.listItems', async () => {
    expect(await listItems(managerA, { storeId: storeB })).toEqual([]);
    expect(await listItems(superAdmin, { storeId: storeB })).toHaveLength(1);
  });

  it('inventory.listLowStock', async () => {
    expect(await listLowStock(managerA, storeB, 10, 50)).toEqual([]);
    expect(await listLowStock(superAdmin, storeB, 10, 50)).toHaveLength(1);
  });

  it('inventory.listLedger', async () => {
    expect(await listLedger(managerA, { storeId: storeB })).toEqual([]);
    expect(await listLedger(superAdmin, { storeId: storeB })).toHaveLength(1);
  });

  it('inventory.listImportRuns', async () => {
    expect(await listImportRuns(managerA, storeB, 50)).toEqual([]);
    expect(await listImportRuns(superAdmin, storeB, 50)).toHaveLength(1);
  });

  it('pricing.listListings', async () => {
    expect(await listListings(managerA, { storeId: storeB })).toEqual([]);
    expect(await listListings(superAdmin, { storeId: storeB })).toHaveLength(1);
  });

  it('pricing.listListedProductIds', async () => {
    expect(await listListedProductIds(managerA, storeB)).toEqual([]);
    expect(await listListedProductIds(superAdmin, storeB)).toEqual([productId]);
  });

  it('stores.listZones', async () => {
    expect(await listZones(managerA, storeB)).toEqual([]);
    expect(await listZones(superAdmin, storeB)).toHaveLength(1);
  });
});
