import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, withTransaction, type Principal } from '@/modules/platform';
import { applyMovement } from '@/modules/inventory';
import { createOrder } from '@/modules/orders';
import { acceptOrder, recordLinePick, startPicking } from '@/modules/fulfillment';
import {
  createCustomer,
  createInventoryItem,
  createProduct,
  createStoreProduct,
  createStoreWithProduct,
  createUser,
} from '../factories/index';

/**
 * A substitution is three writes — restore the ordered product, take the
 * substitute, record the line — plus an audit row. If anything after the stock
 * movements fails, the movements must not stay behind: the shelf would show
 * units gone for a line that is still to pick. The audit write is the last
 * thing in the transaction, so making *it* fail proves the whole thing rolls
 * back. The failure is real: a Postgres trigger on `AuditLog` that raises for
 * this one line's row. (Not a module mock — the integration project runs with
 * `isolate: false`, so a mocked `platform` is not reliably the one the service
 * already holds.)
 */
const prisma = getPrisma();
const shopper: Principal = { kind: 'customer', customerId: null, storeId: null };

let storeId: string;
let productA: string;
let productA2: string;
let categoryId: string;
let customerId: string;
let staff: Principal;
let staffUserId: string;

beforeAll(async () => {
  const a = await createStoreWithProduct(prisma, { websiteStock: 100 });
  storeId = a.store.id;
  productA = a.product.id;
  categoryId = a.product.categoryId;
  productA2 = (await createProduct(prisma, { categoryId })).id;
  await createStoreProduct(prisma, storeId, productA2, { sellingPricePaise: 5_000 });
  await createInventoryItem(prisma, storeId, productA2, { websiteStock: 50 });
  customerId = (await createCustomer(prisma)).id;
  const s = await createUser(prisma, { role: 'STORE_STAFF', storeId });
  staffUserId = s.id;
  staff = { kind: 'user', userId: s.id, role: 'STORE_STAFF', storeId };
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_audit_down ON "AuditLog"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_audit_down()');
  await prisma.auditLog.deleteMany({ where: { storeId } });
  await prisma.order.deleteMany({ where: { storeId } });
  await prisma.stockLedger.deleteMany({ where: { storeId } });
  await prisma.inventoryItem.deleteMany({ where: { storeId } });
  await prisma.storeProduct.deleteMany({ where: { storeId } });
  await prisma.product.deleteMany({ where: { id: { in: [productA, productA2] } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.storeSettings.deleteMany({ where: { storeId } });
  await prisma.store.deleteMany({ where: { id: storeId } });
  await prisma.user.deleteMany({ where: { id: staffUserId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.$disconnect();
});

async function stockOf(productId: string): Promise<number> {
  const item = await prisma.inventoryItem.findFirstOrThrow({ where: { storeId, productId } });
  return item.websiteStock;
}

async function inPicking(qty: number): Promise<{ id: string; lineId: string }> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
  const id = await withTransaction(async (tx) => {
    await applyMovement(tx, shopper, {
      storeId,
      productId: productA,
      delta: -qty,
      reason: 'ORDER_PLACED',
    });
    const created = await createOrder(tx, {
      storeCode: store.code,
      customerId,
      storeId,
      contactName: 'Asha',
      contactPhone: '9000000001',
      deliveryAddressSnapshot: { line1: '1 Test Street', pincode: '560001' },
      deliverySlotStart: new Date('2026-03-01T10:00:00Z'),
      deliverySlotEnd: new Date('2026-03-01T11:00:00Z'),
      paymentMethod: 'COD',
      subtotalPaise: 12_500 * qty,
      deliveryFeePaise: 3_000,
      lines: [
        {
          productId: productA,
          nameSnapshot: 'Test Product',
          packSizeSnapshot: '1 kg',
          unitPricePaise: 12_500,
          qtyOrdered: qty,
        },
      ],
    });
    return created.id;
  });
  await acceptOrder(staff, id);
  await startPicking(staff, id);
  const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: id } });
  return { id, lineId: line.id };
}

/** Make the audit insert for `entityId` fail inside whatever transaction writes it. */
async function auditStoreDownFor(entityId: string): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION test_audit_down() RETURNS trigger AS $$
    BEGIN RAISE EXCEPTION 'audit store is down'; END
    $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER test_audit_down BEFORE INSERT ON "AuditLog"
    FOR EACH ROW WHEN (NEW."entityId" = '${entityId}')
    EXECUTE FUNCTION test_audit_down()`);
}

describe('a substitution whose later write fails', () => {
  it('leaves neither stock movement, no ledger rows, and the line still to pick', async () => {
    const beforeA = await stockOf(productA);
    const beforeA2 = await stockOf(productA2);
    const { id, lineId } = await inPicking(2);
    expect(await stockOf(productA)).toBe(beforeA - 2);

    await auditStoreDownFor(lineId);
    await expect(
      recordLinePick(staff, id, lineId, {
        outcome: 'SUBSTITUTED',
        qtyPicked: 2,
        substituteProductId: productA2,
      }),
    ).rejects.toThrow(/audit store is down/);

    expect(await stockOf(productA)).toBe(beforeA - 2);
    expect(await stockOf(productA2)).toBe(beforeA2);
    expect(await prisma.stockLedger.count({ where: { refId: id } })).toBe(0);
    expect(await prisma.orderLine.findUniqueOrThrow({ where: { id: lineId } })).toMatchObject({
      lineStatus: 'PENDING',
      qtyPicked: null,
      stockRestoredQty: 0,
      substituteProductId: null,
    });

    // With the audit store back, the same call goes through whole.
    await prisma.$executeRawUnsafe('DROP TRIGGER test_audit_down ON "AuditLog"');
    await recordLinePick(staff, id, lineId, {
      outcome: 'SUBSTITUTED',
      qtyPicked: 2,
      substituteProductId: productA2,
    });
    expect(await stockOf(productA)).toBe(beforeA);
    expect(await stockOf(productA2)).toBe(beforeA2 - 2);
    expect(await prisma.stockLedger.count({ where: { refId: id } })).toBe(2);
  });
});
