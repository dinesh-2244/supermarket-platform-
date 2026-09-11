import {
  getStore,
  listServiceableAreas,
  resolveServiceability,
  type StorefrontArea,
  type StoreRecord,
} from '@/modules/stores';

function formatRupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}₹${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}

export interface CommunityConfig {
  readonly id: string;
  readonly storeCode: string;
  readonly name: string;
  readonly shortName: string;
  readonly subtitle: string;
  readonly hubName: string;
}

/**
 * Single authoritative mapping from store code/identifier to customer-facing community metadata.
 * Sourced purely from configuration. Independent of area names or sort order.
 */
export const STORE_COMMUNITIES: readonly CommunityConfig[] = [
  {
    id: 'store-1',
    storeCode: 'S1',
    name: 'Store 1 Community',
    shortName: 'Store 1',
    subtitle: 'Store 1 · Scheduled Slot Delivery',
    hubName: 'Store 1 Hub',
  },
  {
    id: 'store-2',
    storeCode: 'S2',
    name: 'Store 2 Community',
    shortName: 'Store 2',
    subtitle: 'Store 2 · Scheduled Slot Delivery',
    hubName: 'Store 2 Hub',
  },
] as const;

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
 * Resolves the community card configuration for each store.
 *
 * Uses explicit store code / ID mapping from STORE_COMMUNITIES.
 * Zero reliance on area names (e.g. Jayanagar/Indiranagar) or database query ordering.
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

  // Fetch Store records to map storeId to authoritative store.code
  const storeIds = Array.from(storeGroups.keys());
  const storeMap = new Map<string, StoreRecord>();

  await Promise.all(
    storeIds.map(async (storeId) => {
      try {
        const store = await getStore({ kind: 'customer', customerId: null, storeId }, storeId);
        storeMap.set(storeId, store);
      } catch {
        // Fallback gracefully if permission or fetch fails
      }
    }),
  );

  const cards: CommunityCardData[] = [];

  for (const config of STORE_COMMUNITIES) {
    // Find storeId matching config.storeCode authoritatively
    let matchedStoreId: string | undefined;
    for (const [storeId, store] of storeMap.entries()) {
      if (store.code.toLowerCase() === config.storeCode.toLowerCase()) {
        matchedStoreId = storeId;
        break;
      }
    }

    if (!matchedStoreId) continue;

    const storeAreas = storeGroups.get(matchedStoreId) ?? [];
    const primaryArea = storeAreas[0];

    const serviceability = primaryArea?.areaId
      ? await resolveServiceability({ areaId: primaryArea.areaId })
      : null;

    const deliveryNote = serviceability?.servable
      ? `Scheduled Slots · Fresh Daily · Min Order ${formatRupees(serviceability.minOrderPaise)}`
      : 'Scheduled Slots · Fresh Daily';

    cards.push({
      id: config.id,
      name: config.name,
      shortName: config.shortName,
      subtitle: config.subtitle,
      storeId: matchedStoreId,
      primaryAreaId: primaryArea?.areaId ?? '',
      isAcceptingOrders: primaryArea?.isAcceptingOrders ?? true,
      deliveryNote,
      areas: storeAreas,
    });
  }

  return cards;
}

const DEFAULT_COMMUNITY: CommunityConfig = {
  id: 'store-1',
  storeCode: 'S1',
  name: 'Store 1 Community',
  shortName: 'Store 1',
  subtitle: 'Store 1 · Scheduled Slot Delivery',
  hubName: 'Store 1 Hub',
};

/**
 * Single authoritative helper to get community metadata for any store.
 */
export function getCommunityConfigForStore(
  store?: { id?: string | null; code?: string | null; name?: string | null } | null,
): CommunityConfig {
  if (store == null) return STORE_COMMUNITIES[0] ?? DEFAULT_COMMUNITY;
  const storeCode = store.code?.toLowerCase();
  const storeId = store.id?.toLowerCase();
  const storeName = store.name?.toLowerCase();

  const matched = STORE_COMMUNITIES.find((c) => {
    if (storeCode !== undefined && c.storeCode.toLowerCase() === storeCode) {
      return true;
    }
    if (storeId !== undefined && c.id.toLowerCase() === storeId) {
      return true;
    }
    if (storeName?.includes(c.shortName.toLowerCase()) === true) {
      return true;
    }
    return false;
  });

  if (matched !== undefined) return matched;
  return {
    id: store.id ?? 'store-default',
    storeCode: store.code ?? '',
    name: store.name ?? 'Store Community',
    shortName: store.code ?? 'Store',
    subtitle: `${store.name ?? 'Store'} · Scheduled Slot Delivery`,
    hubName: `${store.name ?? 'Store'} Hub`,
  };
}

/**
 * Translates an internal store record or id into the customer-facing community name.
 * Uses the single STORE_COMMUNITIES mapping table.
 */
export function communityNameForStore(
  storeOrId?: string | { id?: string | null; code?: string | null; name?: string | null } | null,
  storeName?: string | null,
): string {
  if (storeOrId == null) return 'Store Community';
  if (typeof storeOrId === 'object') {
    return getCommunityConfigForStore(storeOrId).name;
  }
  const lowerName = storeName?.toLowerCase();
  const config = STORE_COMMUNITIES.find((c) => {
    if (c.id === storeOrId || c.storeCode === storeOrId) return true;
    if (lowerName?.includes(c.shortName.toLowerCase()) === true) {
      return true;
    }
    return false;
  });
  return config?.name ?? storeName ?? 'Store Community';
}
