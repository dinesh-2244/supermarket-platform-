import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../platform/index';
import {
  assertEditableSettings,
  assertOptionalPincode,
  assertStoreCode,
  descriptor,
  normalizeLocality,
  resolveServiceabilityFrom,
  type AreaCandidate,
} from '../domain/index';
import { moduleDescriptor } from '../service';

const STORE_A = 'store-a';
const STORE_B = 'store-b';
const SHARED_PINCODE = '560001';

function area(overrides: Partial<AreaCandidate> & Pick<AreaCandidate, 'areaId'>): AreaCandidate {
  return {
    areaName: 'Somewhere',
    pincode: null,
    matchHints: [],
    zoneId: 'zone-1',
    storeId: STORE_A,
    storeIsActive: true,
    isAcceptingOrders: true,
    deliveryFeePaise: 3000,
    minOrderPaise: 20_000,
    slotLengthMinutes: 60,
    slotCapacity: 10,
    ...overrides,
  };
}

/**
 * The case ADR-0004 exists for: two localities under *different* stores that
 * share one pincode. Matching on pincode as though it were the routing key
 * would send half these orders to the wrong shop.
 */
const indiranagar = area({
  areaId: 'area-indiranagar',
  areaName: 'Indiranagar',
  pincode: SHARED_PINCODE,
  zoneId: 'zone-a',
  storeId: STORE_A,
  matchHints: ['Indira Nagar', '100 Feet Road'],
  deliveryFeePaise: 3000,
});
const domlur = area({
  areaId: 'area-domlur',
  areaName: 'Domlur',
  pincode: SHARED_PINCODE,
  zoneId: 'zone-b',
  storeId: STORE_B,
  matchHints: ['Domlur Layout'],
  deliveryFeePaise: 4000,
});
const koramangala = area({
  areaId: 'area-koramangala',
  areaName: 'Koramangala',
  pincode: '560034',
  zoneId: 'zone-b',
  storeId: STORE_B,
});

const CANDIDATES = [indiranagar, domlur, koramangala];

describe('stores module descriptor', () => {
  it('declares what it owns', () => {
    expect(moduleDescriptor()).toEqual(descriptor);
    expect(descriptor.dependsOn).toEqual(['platform']);
  });
});

describe('resolveServiceability — the shared-pincode case (R8 / ADR-0004)', () => {
  it('routes each shared-pincode locality to its own store', () => {
    const a = resolveServiceabilityFrom(
      { locality: 'Indiranagar', pincode: SHARED_PINCODE },
      CANDIDATES,
    );
    const b = resolveServiceabilityFrom(
      { locality: 'Domlur', pincode: SHARED_PINCODE },
      CANDIDATES,
    );

    expect(a).toMatchObject({ servable: true, storeId: STORE_A, areaId: 'area-indiranagar' });
    expect(b).toMatchObject({ servable: true, storeId: STORE_B, areaId: 'area-domlur' });
  });

  // The pincode alone genuinely does not identify a store here. Guessing would
  // be worse than saying so.
  it('refuses to guess when a pincode alone spans two stores', () => {
    expect(resolveServiceabilityFrom({ pincode: SHARED_PINCODE }, CANDIDATES)).toEqual({
      servable: false,
      reason: 'out-of-zone',
    });
  });

  it('accepts a pincode alone when it identifies exactly one area', () => {
    expect(resolveServiceabilityFrom({ pincode: '560034' }, CANDIDATES)).toMatchObject({
      servable: true,
      storeId: STORE_B,
      areaId: 'area-koramangala',
    });
  });

  it('accepts a pincode that spans several areas of the *same* store', () => {
    const twoInB = [
      domlur,
      area({
        areaId: 'area-domlur-2',
        areaName: 'Old Domlur',
        pincode: SHARED_PINCODE,
        storeId: STORE_B,
      }),
    ];
    expect(resolveServiceabilityFrom({ pincode: SHARED_PINCODE }, twoInB)).toMatchObject({
      servable: true,
      storeId: STORE_B,
    });
  });
});

describe('resolveServiceability — matching', () => {
  it('prefers an explicit area id over anything else', () => {
    expect(resolveServiceabilityFrom({ areaId: 'area-domlur' }, CANDIDATES)).toMatchObject({
      servable: true,
      storeId: STORE_B,
      areaId: 'area-domlur',
    });
  });

  it('reports an unknown area id rather than falling back to a guess', () => {
    expect(resolveServiceabilityFrom({ areaId: 'nope', pincode: '560034' }, CANDIDATES)).toEqual({
      servable: false,
      reason: 'unknown-area',
    });
  });

  it('matches on a curated hint', () => {
    expect(resolveServiceabilityFrom({ locality: 'Indira Nagar' }, CANDIDATES)).toMatchObject({
      servable: true,
      areaId: 'area-indiranagar',
    });
    expect(resolveServiceabilityFrom({ locality: '100 feet road' }, CANDIDATES)).toMatchObject({
      servable: true,
      storeId: STORE_A,
    });
  });

  it('is insensitive to case, spacing and punctuation', () => {
    for (const spelling of ['  INDIRANAGAR ', 'indira-nagar', 'Indira  Nagar']) {
      expect(resolveServiceabilityFrom({ locality: spelling }, CANDIDATES)).toMatchObject({
        servable: true,
        storeId: STORE_A,
      });
    }
  });

  // The pincode was only ever a hint, so a right locality with a wrong pincode
  // still resolves.
  it('still resolves a known locality when the pincode is mistyped', () => {
    expect(
      resolveServiceabilityFrom({ locality: 'Koramangala', pincode: '999999' }, CANDIDATES),
    ).toMatchObject({ servable: true, storeId: STORE_B, areaId: 'area-koramangala' });
  });

  it('returns the store’s delivery quote with the match', () => {
    expect(resolveServiceabilityFrom({ areaId: 'area-domlur' }, CANDIDATES)).toMatchObject({
      deliveryFeePaise: 4000,
      minOrderPaise: 20_000,
      slotLengthMinutes: 60,
      slotCapacity: 10,
    });
  });
});

describe('resolveServiceability — refusals', () => {
  it('is out of zone for an address we do not serve', () => {
    expect(resolveServiceabilityFrom({ locality: 'Whitefield' }, CANDIDATES)).toEqual({
      servable: false,
      reason: 'out-of-zone',
    });
    expect(resolveServiceabilityFrom({ pincode: '110001' }, CANDIDATES)).toEqual({
      servable: false,
      reason: 'out-of-zone',
    });
  });

  it('says so when given nothing to go on', () => {
    expect(resolveServiceabilityFrom({}, CANDIDATES)).toEqual({
      servable: false,
      reason: 'no-input',
    });
    expect(resolveServiceabilityFrom({ locality: '   ' }, CANDIDATES)).toEqual({
      servable: false,
      reason: 'no-input',
    });
  });

  it('ignores areas of an inactive store entirely', () => {
    const closed = CANDIDATES.map((c) =>
      c.storeId === STORE_B ? { ...c, storeIsActive: false } : c,
    );
    expect(resolveServiceabilityFrom({ areaId: 'area-domlur' }, closed)).toEqual({
      servable: false,
      reason: 'unknown-area',
    });
    // …and with store B gone, the shared pincode is now unambiguous.
    expect(resolveServiceabilityFrom({ pincode: SHARED_PINCODE }, closed)).toMatchObject({
      servable: true,
      storeId: STORE_A,
    });
  });

  // Distinct from out-of-zone: we do deliver here, just not right now.
  it('distinguishes a store that has paused orders from one that does not deliver', () => {
    const paused = CANDIDATES.map((c) =>
      c.storeId === STORE_A ? { ...c, isAcceptingOrders: false } : c,
    );
    expect(resolveServiceabilityFrom({ locality: 'Indiranagar' }, paused)).toEqual({
      servable: false,
      reason: 'store-closed',
    });
  });

  it('handles an empty catalogue of areas', () => {
    expect(resolveServiceabilityFrom({ locality: 'Anywhere' }, [])).toEqual({
      servable: false,
      reason: 'out-of-zone',
    });
  });
});

describe('stores/domain — validation', () => {
  it('normalises localities', () => {
    expect(normalizeLocality('  HSR-Layout,  Sector 2 ')).toBe('hsr layout sector 2');
  });

  it('accepts an optional, non-unique six-digit pincode', () => {
    expect(assertOptionalPincode('560 001')).toBe('560001');
    expect(assertOptionalPincode(null)).toBeNull();
    expect(assertOptionalPincode('')).toBeNull();
    expect(() => assertOptionalPincode('5600')).toThrow(ValidationError);
    expect(() => assertOptionalPincode('abcdef')).toThrow(ValidationError);
  });

  it('normalises and validates a store code', () => {
    expect(assertStoreCode(' hsr-1 ')).toBe('HSR-1');
    expect(() => assertStoreCode('x')).toThrow(ValidationError);
    expect(() => assertStoreCode('has space')).toThrow(ValidationError);
  });

  it('keeps money settings integer paise and slots positive', () => {
    expect(() => {
      assertEditableSettings({ deliveryFeePaise: 30.5 });
    }).toThrow(ValidationError);
    expect(() => {
      assertEditableSettings({ minOrderPaise: -1 });
    }).toThrow(ValidationError);
    expect(() => {
      assertEditableSettings({ slotCapacity: 0 });
    }).toThrow(ValidationError);
    expect(() => {
      assertEditableSettings({ priceVariancePercentBp: 10_001 });
    }).toThrow(ValidationError);
    expect(() => {
      assertEditableSettings({ deliveryFeePaise: 3000, slotCapacity: 10, lowStockThreshold: 0 });
    }).not.toThrow();
  });
});
