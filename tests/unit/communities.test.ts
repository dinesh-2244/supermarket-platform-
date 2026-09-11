import { beforeEach, describe, expect, test, vi } from 'vitest';

const { listServiceableAreas, getStore, resolveServiceability } = vi.hoisted(() => ({
  listServiceableAreas: vi.fn(),
  getStore: vi.fn(),
  resolveServiceability: vi.fn(),
}));

vi.mock('@/modules/stores', () => ({
  listServiceableAreas,
  getStore,
  resolveServiceability,
}));

import {
  STORE_COMMUNITIES,
  communityNameForStore,
  getCommunityCards,
  getCommunityConfigForStore,
} from '../../src/app/(storefront)/communities';

/**
 * Unit tests proving that Store 1 / Store 2 community assignment is stable,
 * config-driven, and completely independent of area names or sort order (M3).
 */
describe('Storefront Communities mapping stability (M3)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test('STORE_COMMUNITIES provides single authoritative mapping keyed on storeCode', () => {
    expect(STORE_COMMUNITIES).toHaveLength(2);
    expect(STORE_COMMUNITIES[0]).toMatchObject({
      id: 'store-1',
      storeCode: 'S1',
      name: 'Store 1 Community',
      shortName: 'Store 1',
    });
    expect(STORE_COMMUNITIES[1]).toMatchObject({
      id: 'store-2',
      storeCode: 'S2',
      name: 'Store 2 Community',
      shortName: 'Store 2',
    });
  });

  test('community assignment is stable across arbitrary store renames', () => {
    // Stores renamed to future quarters names without legacy Jayanagar / Indiranagar strings
    const renamedStore1 = { id: 'uuid-1', code: 'S1', name: 'Northern Quarters Hub' };
    const renamedStore2 = { id: 'uuid-2', code: 'S2', name: 'Southern Quarters Hub' };

    const c1 = getCommunityConfigForStore(renamedStore1);
    const c2 = getCommunityConfigForStore(renamedStore2);

    expect(c1.name).toBe('Store 1 Community');
    expect(c1.shortName).toBe('Store 1');
    expect(c2.name).toBe('Store 2 Community');
    expect(c2.shortName).toBe('Store 2');

    expect(communityNameForStore(renamedStore1)).toBe('Store 1 Community');
    expect(communityNameForStore(renamedStore2)).toBe('Store 2 Community');
  });

  test('getCommunityCards resolves store IDs strictly by store.code regardless of area sort order', async () => {
    // Supply areas where Store 2's areas come first alphabetically
    listServiceableAreas.mockResolvedValue([
      {
        areaId: 'area-alpha',
        areaName: 'Aardvark Heights (Store 2 Area)',
        storeId: 'store-2-uuid',
        pincode: '560001',
        isAcceptingOrders: true,
      },
      {
        areaId: 'area-beta',
        areaName: 'Beta Sector (Store 2 Area)',
        storeId: 'store-2-uuid',
        pincode: '560001',
        isAcceptingOrders: true,
      },
      {
        areaId: 'area-zebra',
        areaName: 'Zebra Enclave (Store 1 Area)',
        storeId: 'store-1-uuid',
        pincode: '560099',
        isAcceptingOrders: true,
      },
    ]);

    getStore.mockImplementation((_principal: unknown, storeId: string) => {
      if (storeId === 'store-1-uuid') {
        return Promise.resolve({ id: 'store-1-uuid', code: 'S1', name: 'Store One Custom' });
      }
      if (storeId === 'store-2-uuid') {
        return Promise.resolve({ id: 'store-2-uuid', code: 'S2', name: 'Store Two Custom' });
      }
      return Promise.reject(new Error(`Unexpected storeId: ${storeId}`));
    });

    resolveServiceability.mockResolvedValue({
      servable: true,
      minOrderPaise: 50000,
    });

    const cards = await getCommunityCards();

    expect(cards).toHaveLength(2);

    // Store 1 community is mapped strictly to store-1-uuid (S1), despite its areas being last
    expect(cards[0]).toMatchObject({
      id: 'store-1',
      name: 'Store 1 Community',
      shortName: 'Store 1',
      storeId: 'store-1-uuid',
      primaryAreaId: 'area-zebra',
    });

    // Store 2 community is mapped strictly to store-2-uuid (S2), despite its areas being first
    expect(cards[1]).toMatchObject({
      id: 'store-2',
      name: 'Store 2 Community',
      shortName: 'Store 2',
      storeId: 'store-2-uuid',
      primaryAreaId: 'area-alpha',
    });
  });

  test('getCommunityCards fails closed when getStore fails for one store (never duplicates or swaps storeId)', async () => {
    // Areas supplied Store 2 first, then Store 1
    listServiceableAreas.mockResolvedValue([
      {
        areaId: 'area-alpha',
        areaName: 'Aardvark Heights (Store 2 Area)',
        storeId: 'store-2-uuid',
        pincode: '560001',
        isAcceptingOrders: true,
      },
      {
        areaId: 'area-zebra',
        areaName: 'Zebra Enclave (Store 1 Area)',
        storeId: 'store-1-uuid',
        pincode: '560099',
        isAcceptingOrders: true,
      },
    ]);

    // Store 1 getStore fails, while Store 2 succeeds
    getStore.mockImplementation((_principal: unknown, storeId: string) => {
      if (storeId === 'store-1-uuid') {
        return Promise.reject(new Error('Database / network error fetching Store 1'));
      }
      if (storeId === 'store-2-uuid') {
        return Promise.resolve({ id: 'store-2-uuid', code: 'S2', name: 'Store Two Custom' });
      }
      return Promise.reject(new Error(`Unexpected storeId: ${storeId}`));
    });

    resolveServiceability.mockResolvedValue({
      servable: true,
      minOrderPaise: 50000,
    });

    const cards = await getCommunityCards();

    // Must fail closed: only the verified store is returned
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: 'store-2',
      name: 'Store 2 Community',
      shortName: 'Store 2',
      storeId: 'store-2-uuid',
    });

    // Explicitly verify Store 2's ID was NOT assigned to Store 1's community
    const store1Card = cards.find((c) => c.id === 'store-1');
    expect(store1Card).toBeUndefined();

    // Explicitly verify no duplicate store IDs exist
    const storeIds = cards.map((c) => c.storeId);
    expect(new Set(storeIds).size).toBe(storeIds.length);
  });

  test('getCommunityCards fails closed if store codes do not match configured codes', async () => {
    listServiceableAreas.mockResolvedValue([
      {
        areaId: 'area-1',
        areaName: 'Area 1',
        storeId: 'store-x-uuid',
        pincode: '560001',
        isAcceptingOrders: true,
      },
    ]);

    getStore.mockResolvedValue({
      id: 'store-x-uuid',
      code: 'UNKNOWN_CODE',
      name: 'Unknown Store',
    });

    const cards = await getCommunityCards();
    expect(cards).toHaveLength(0);
  });
});
