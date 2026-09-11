import { listServiceableAreas, resolveServiceability, type StorefrontArea } from '@/modules/stores';
import { rupees } from './ui';

export interface CommunityCardData {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly subtitle: string;
  readonly storeId: string;
  readonly primaryAreaId: string;
  readonly isAcceptingOrders: boolean;
  readonly deliveryNote: string;
  readonly areas: readonly StorefrontArea[];
}

/**
 * Maps the platform's two stores to the two community choices (D2).
 *
 * Config-driven neutral placeholders:
 * 1. Store 1 Community (served by Store 1)
 * 2. Store 2 Community (served by Store 2)
 *
 * Authoritative store settings (min order, delivery fee, open/paused)
 * are resolved dynamically via resolveServiceability rather than hardcoded.
 */
export async function getCommunityCards(): Promise<readonly CommunityCardData[]> {
  const areas = await listServiceableAreas();

  // Group active areas by storeId
  const storeGroups = new Map<string, StorefrontArea[]>();
  for (const area of areas) {
    const list = storeGroups.get(area.storeId) ?? [];
    list.push(area);
    storeGroups.set(area.storeId, list);
  }

  let s1Areas: StorefrontArea[] = [];
  let s2Areas: StorefrontArea[] = [];
  let store1Id: string | undefined;
  let store2Id: string | undefined;

  for (const [storeId, group] of storeGroups.entries()) {
    if (group.some((a) => a.areaName.toLowerCase().includes('jayanagar'))) {
      s1Areas = group;
      store1Id = storeId;
    } else if (group.some((a) => a.areaName.toLowerCase().includes('indiranagar'))) {
      s2Areas = group;
      store2Id = storeId;
    }
  }

  // Fallback if area names are customized or different in other environments
  if (s1Areas.length === 0 || s2Areas.length === 0) {
    const storeIds = Array.from(storeGroups.keys());
    store1Id = store1Id ?? storeIds[0] ?? '';
    store2Id = store2Id ?? storeIds[1] ?? '';
    s1Areas = s1Areas.length > 0 ? s1Areas : (storeGroups.get(store1Id) ?? []);
    s2Areas = s2Areas.length > 0 ? s2Areas : (storeGroups.get(store2Id) ?? []);
  }

  // Preferred primary area for each community
  const s1Primary = s1Areas.find((a) => a.areaName.includes('4th Block')) ?? s1Areas[0];
  const s2Primary = s2Areas.find((a) => a.areaName.includes('1st Stage')) ?? s2Areas[0];

  // Resolve authoritative store settings dynamically from StoreSettings via serviceability
  const [s1Settings, s2Settings] = await Promise.all([
    s1Primary?.areaId ? resolveServiceability({ areaId: s1Primary.areaId }) : null,
    s2Primary?.areaId ? resolveServiceability({ areaId: s2Primary.areaId }) : null,
  ]);

  const s1DeliveryNote = s1Settings?.servable
    ? `Scheduled Slots · Fresh Daily · Min Order ${rupees(s1Settings.minOrderPaise)}`
    : 'Scheduled Slots · Fresh Daily';
  const s2DeliveryNote = s2Settings?.servable
    ? `Scheduled Slots · Fresh Daily · Min Order ${rupees(s2Settings.minOrderPaise)}`
    : 'Scheduled Slots · Fresh Daily';

  const c1: CommunityCardData = {
    id: 'store-1',
    name: 'Store 1 Community',
    shortName: 'Store 1',
    subtitle: 'Store 1 · Scheduled Slot Delivery',
    storeId: store1Id ?? '',
    primaryAreaId: s1Primary?.areaId ?? '',
    isAcceptingOrders: s1Primary?.isAcceptingOrders ?? true,
    deliveryNote: s1DeliveryNote,
    areas: s1Areas,
  };

  const c2: CommunityCardData = {
    id: 'store-2',
    name: 'Store 2 Community',
    shortName: 'Store 2',
    subtitle: 'Store 2 · Scheduled Slot Delivery',
    storeId: store2Id ?? '',
    primaryAreaId: s2Primary?.areaId ?? '',
    isAcceptingOrders: s2Primary?.isAcceptingOrders ?? true,
    deliveryNote: s2DeliveryNote,
    areas: s2Areas,
  };

  return [c1, c2];
}

/**
 * Translates an internal store entity name into the customer-facing community name.
 */
export function communityNameForStore(storeId?: string | null, storeName?: string | null): string {
  if (storeName?.includes('Jayanagar') || storeName?.includes('S1')) {
    return 'Store 1 Community';
  }
  if (storeName?.includes('Indiranagar') || storeName?.includes('S2')) {
    return 'Store 2 Community';
  }
  return storeName ?? 'Store Community';
}
