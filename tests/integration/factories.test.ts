import { afterAll, describe, expect, it } from 'vitest';
import { createOrder, createStoreWithProduct, createCustomer } from '../factories/index';
import { newTestClient } from './prisma-client';

const prisma = newTestClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('test factories', () => {
  it('builds a store with a listed, stocked product', async () => {
    await prisma
      .$transaction(async (tx) => {
        const { store, storeProduct, inventoryItem } = await createStoreWithProduct(tx, {
          websiteStock: 7,
        });

        expect(storeProduct.storeId).toBe(store.id);
        expect(storeProduct.isListed).toBe(true);
        expect(inventoryItem.websiteStock).toBe(7);

        // Roll back: factories must not leave rows behind for the next test.
        throw new RollbackSignal();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RollbackSignal)) throw error;
      });
  });

  it('builds an order with the required snapshots', async () => {
    await prisma
      .$transaction(async (tx) => {
        const { store } = await createStoreWithProduct(tx);
        const customer = await createCustomer(tx);
        const order = await createOrder(tx, store.id, customer.id);

        expect(order.status).toBe('PLACED');
        expect(order.priceVarianceFlagged).toBe(false);
        expect(order.customerConfirmedRevisedAmount).toBe(false);
        expect(order.contactPhoneSnapshot).toBe('9000000000');

        throw new RollbackSignal();
      })
      .catch((error: unknown) => {
        if (!(error instanceof RollbackSignal)) throw error;
      });
  });
});

/** Sentinel used to roll a factory transaction back without failing the test. */
class RollbackSignal extends Error {}
