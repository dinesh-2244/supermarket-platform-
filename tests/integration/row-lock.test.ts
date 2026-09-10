import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPrisma, selectForUpdate, withTransaction } from '@/modules/platform';
import {
  createCategory,
  createInventoryItem,
  createProduct,
  createStore,
  createStoreProduct,
  createStoreSettings,
} from '../factories/index';
import { newTestClient } from './prisma-client';

/**
 * R3 — a row lock must stay held until the transaction ends.
 *
 * Two *separate connections*: the first takes the lock, the second tries to take
 * the same lock with `NOWAIT`, which makes PostgreSQL raise 55P03
 * (`lock_not_available`) immediately instead of blocking. That turns "is the row
 * still locked?" into a deterministic assertion with no sleeping.
 *
 * The last case is the bug this fix exists for: the same statement run *outside*
 * a transaction commits its implicit transaction the moment it returns, so the
 * second connection takes the lock straight away. That path is now a compile
 * error (see tests/unit/transaction-handle.test.ts); the raw SQL is inlined here
 * to prove the behaviour it used to permit.
 */
const observer = newTestClient();

/**
 * Committed fixtures, not the usual rolled-back ones: the whole point is that a
 * *second connection* can see the row. Fixed identifiers rather than the
 * factories' per-process sequence, which restarts at 1 in every test file and
 * would collide with the rolled-back rows another file is creating.
 */
const CODE = 'RL-LOCK';
const SKU = 'SKU-ROW-LOCK';
const SLUG = 'row-lock-product';
const CATEGORY_SLUG = 'row-lock-category';

let storeId: string;
let productId: string;

async function removeFixtures(): Promise<void> {
  const prisma = getPrisma();
  const store = await prisma.store.findUnique({ where: { code: CODE } });
  const product = await prisma.product.findUnique({ where: { sku: SKU } });

  if (store) {
    await prisma.stockLedger.deleteMany({ where: { storeId: store.id } });
    await prisma.inventoryItem.deleteMany({ where: { storeId: store.id } });
    await prisma.storeProduct.deleteMany({ where: { storeId: store.id } });
    await prisma.storeSettings.deleteMany({ where: { storeId: store.id } });
    await prisma.store.delete({ where: { id: store.id } });
  }
  if (product) await prisma.product.delete({ where: { id: product.id } });
  await prisma.category.deleteMany({ where: { slug: CATEGORY_SLUG } });
}

beforeAll(async () => {
  const prisma = getPrisma();
  await removeFixtures();

  const store = await createStore(prisma, { code: CODE, name: 'Row lock store' });
  await createStoreSettings(prisma, store.id);
  const category = await createCategory(prisma, {
    name: 'Row lock category',
    slug: CATEGORY_SLUG,
  });
  const product = await createProduct(prisma, {
    sku: SKU,
    slug: SLUG,
    name: 'Row lock product',
    categoryId: category.id,
  });
  await createStoreProduct(prisma, store.id, product.id);
  await createInventoryItem(prisma, store.id, product.id, { websiteStock: 5 });

  storeId = store.id;
  productId = product.id;
});

afterAll(async () => {
  await removeFixtures();
  await observer.$disconnect();
});

/** `true` when the observer connection could take the row lock right now. */
async function observerCanLock(): Promise<boolean> {
  try {
    await observer.$queryRaw`
      SELECT "id" FROM "InventoryItem"
      WHERE "storeId" = ${storeId} AND "productId" = ${productId}
      FOR UPDATE NOWAIT
    `;
    return true;
  } catch (error) {
    // 55P03 lock_not_available — someone else is holding the row.
    if (String(error).includes('55P03') || /could not obtain lock/i.test(String(error))) {
      return false;
    }
    throw error;
  }
}

describe('selectForUpdate row locking', () => {
  it('holds the lock for the whole transaction and releases it on commit', async () => {
    let lockedDuringTransaction: boolean | undefined;

    const row = await withTransaction(async (tx) => {
      const locked = await selectForUpdate(tx, storeId, productId);
      expect(locked?.websiteStock).toBe(5);

      // Still inside the transaction: the observer must be shut out.
      lockedDuringTransaction = !(await observerCanLock());

      // A second statement in the same transaction — the point of the lock.
      await tx.inventoryItem.update({
        where: { storeId_productId: { storeId, productId } },
        data: { websiteStock: 4 },
      });
      return locked;
    });

    expect(row).not.toBeNull();
    expect(lockedDuringTransaction).toBe(true);
    // After commit the row is free again, and the update stuck.
    await expect(observerCanLock()).resolves.toBe(true);
    const after = await getPrisma().inventoryItem.findUniqueOrThrow({
      where: { storeId_productId: { storeId, productId } },
    });
    expect(after.websiteStock).toBe(4);
  });

  it('releases the lock when the transaction rolls back', async () => {
    class Rollback extends Error {}

    await expect(
      withTransaction(async (tx) => {
        await selectForUpdate(tx, storeId, productId);
        expect(await observerCanLock()).toBe(false);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);

    await expect(observerCanLock()).resolves.toBe(true);
  });

  it('demonstrates the defect: the same lock outside a transaction is not held', async () => {
    await getPrisma().$queryRaw`
      SELECT "id" FROM "InventoryItem"
      WHERE "storeId" = ${storeId} AND "productId" = ${productId}
      FOR UPDATE
    `;

    // The implicit transaction has already committed — nothing is protected.
    await expect(observerCanLock()).resolves.toBe(true);
  });

  it('refuses the root client at runtime as well as at compile time', async () => {
    const smuggled = getPrisma() as unknown as Parameters<typeof selectForUpdate>[0];
    await expect(selectForUpdate(smuggled, storeId, productId)).rejects.toThrow(
      /transaction handle/i,
    );
  });
});
