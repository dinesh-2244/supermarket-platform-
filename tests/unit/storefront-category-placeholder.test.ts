import { describe, expect, test } from 'vitest';
import { resolveCategoryGroup } from '../../src/app/(storefront)/category-group';
import { STORE_COMMUNITIES } from '../../src/app/(storefront)/communities';
import {
  STOREFRONT_COPY_MANIFEST,
  formatContactHubDescription,
} from '../../src/app/(storefront)/copy-manifest';

describe('resolveCategoryGroup taxonomy resolution', () => {
  test('maps explicit categorySlugs to canonical category groups', () => {
    expect(resolveCategoryGroup({ categorySlug: 'fruits-vegetables' })).toBe('vegetables');
    expect(resolveCategoryGroup({ categorySlug: 'fresh-produce' })).toBe('vegetables');
    expect(resolveCategoryGroup({ categorySlug: 'dairy-bakery' })).toBe('dairy');
    expect(resolveCategoryGroup({ categorySlug: 'milk-products' })).toBe('dairy');
    expect(resolveCategoryGroup({ categorySlug: 'staples' })).toBe('staples');
    expect(resolveCategoryGroup({ categorySlug: 'grains-and-pulses' })).toBe('staples');
    expect(resolveCategoryGroup({ categorySlug: 'snacks-beverages' })).toBe('beverages');
    expect(resolveCategoryGroup({ categorySlug: 'coffee-tea' })).toBe('beverages');
    expect(resolveCategoryGroup({ categorySlug: 'household' })).toBe('household');
    expect(resolveCategoryGroup({ categorySlug: 'home-cleaners' })).toBe('household');
    expect(resolveCategoryGroup({ categorySlug: 'unknown-category' })).toBe('general');
    expect(resolveCategoryGroup({})).toBe('general');
  });

  test('infers category group from product name and slug keywords when categorySlug is omitted', () => {
    expect(resolveCategoryGroup({ productSlug: 'fresh-banana', name: 'Robusta Banana 1kg' })).toBe(
      'vegetables',
    );
    expect(
      resolveCategoryGroup({ productSlug: 'toned-milk-500ml', name: 'Nandini Toned Milk' }),
    ).toBe('dairy');
    expect(resolveCategoryGroup({ productSlug: 'toor-dal', name: 'Organic Toor Dal 1kg' })).toBe(
      'staples',
    );
    expect(resolveCategoryGroup({ productSlug: 'masala-tea', name: 'Tata Tea Premium' })).toBe(
      'beverages',
    );
    expect(
      resolveCategoryGroup({ productSlug: 'dishwash-gel', name: 'Vim Dishwash Gel 500ml' }),
    ).toBe('household');
    expect(resolveCategoryGroup({ productSlug: 'generic-item', name: 'Special Mystery Box' })).toBe(
      'general',
    );
  });
});

describe('Contact Us configuration and copy integrity', () => {
  test('STOREFRONT_COPY_MANIFEST contains contact metadata, app guidance, and channel slots', () => {
    const { contact } = STOREFRONT_COPY_MANIFEST;
    expect(contact.meta.title).toContain('Contact Us');
    expect(contact.meta.description).toBeTruthy();
    expect(contact.hero.title).toBe('Contact Us');
    expect(contact.appNotice.title).toBeTruthy();
    expect(contact.appNotice.description).toContain('resident application');
    expect(contact.channels.phoneLabel).toBeTruthy();
    expect(contact.channels.emailLabel).toBeTruthy();
    expect(contact.channels.hoursLabel).toBeTruthy();
    expect(contact.channels.addressLabel).toBeTruthy();
  });

  test('formatContactHubDescription formats store hub name without placeholders', () => {
    for (const community of STORE_COMMUNITIES) {
      const desc = formatContactHubDescription(community.hubName);
      expect(desc).toContain(community.hubName);
      expect(desc).not.toContain('{hubName}');
    }
  });

  test('STORE_COMMUNITIES contains Store 1 and Store 2', () => {
    const storeCodes = STORE_COMMUNITIES.map((c) => c.storeCode);
    expect(storeCodes).toContain('S1');
    expect(storeCodes).toContain('S2');
  });
});
