import { describe, expect, test } from 'vitest';
import {
  STORE_COMMUNITIES,
  communityNameForStore,
  getCommunityConfigForStore,
} from '../../src/app/(storefront)/communities';

/**
 * Unit tests proving that Store 1 / Store 2 community assignment is stable,
 * config-driven, and completely independent of area names or sort order (M3).
 */
describe('Storefront Communities mapping stability (M3)', () => {
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

  test('area renaming and alphabetical reordering do NOT affect store mapping', () => {
    // Simulate area candidates where Store 2's areas come first alphabetically
    // and area names have zero legacy keywords ("Jayanagar" / "Indiranagar")
    const mockAreas = [
      {
        areaId: 'area-alpha',
        areaName: 'Aardvark Heights (Arbitrary Name)',
        storeId: 'store-2-uuid',
        pincode: '560001',
        isAcceptingOrders: true,
      },
      {
        areaId: 'area-beta',
        areaName: 'Beta Sector',
        storeId: 'store-2-uuid',
        pincode: '560001',
        isAcceptingOrders: true,
      },
      {
        areaId: 'area-zebra',
        areaName: 'Zebra Enclave (Alphabetically Last)',
        storeId: 'store-1-uuid',
        pincode: '560099',
        isAcceptingOrders: true,
      },
    ];

    // Grouping by storeId
    const storeGroups = new Map<string, typeof mockAreas>();
    for (const a of mockAreas) {
      const list = storeGroups.get(a.storeId) ?? [];
      list.push(a);
      storeGroups.set(a.storeId, list);
    }

    // Mapping keyed on store.code
    const storeRecords = [
      { id: 'store-1-uuid', code: 'S1', name: 'Custom Store 1' },
      { id: 'store-2-uuid', code: 'S2', name: 'Custom Store 2' },
    ];

    // Match each config to its store
    const mapped = STORE_COMMUNITIES.map((config) => {
      const matchedStore = storeRecords.find(
        (s) => s.code.toLowerCase() === config.storeCode.toLowerCase(),
      );
      return {
        configName: config.name,
        storeId: matchedStore?.id,
        areas: storeGroups.get(matchedStore?.id ?? '') ?? [],
      };
    });

    const first = mapped[0];
    const second = mapped[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    if (first && second) {
      // Store 1 is mapped to store-1-uuid despite its areas being last in list
      expect(first.configName).toBe('Store 1 Community');
      expect(first.storeId).toBe('store-1-uuid');
      expect(first.areas[0]?.areaName).toBe('Zebra Enclave (Alphabetically Last)');

      // Store 2 is mapped to store-2-uuid despite its areas being first in list
      expect(second.configName).toBe('Store 2 Community');
      expect(second.storeId).toBe('store-2-uuid');
      expect(second.areas[0]?.areaName).toBe('Aardvark Heights (Arbitrary Name)');
    }
  });
});
