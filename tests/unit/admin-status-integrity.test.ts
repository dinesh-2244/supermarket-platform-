import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTIONABLE_ORDER_STATUSES, adminHref, navigationFor } from '@/modules/admin';
import { ORDER_STATUSES, type OrderStatus } from '@/modules/orders';

/**
 * Regression guard for Admin Order Status integrity (M3).
 *
 * Ensures:
 * 1. OrderStatusBadge in ui.tsx exhaustively maps all 12 domain OrderStatus values.
 * 2. Closed states (CLOSED, CLOSED_UNDELIVERED) are present with valid styles.
 * 3. Nonexistent statuses (CANCELLED_BY_CUSTOMER, REFUNDED) never reappear.
 * 4. Report pipeline role classification derives from domain ACTIONABLE_ORDER_STATUSES.
 */
describe('Admin Order Status domain integrity (M3 regression guard)', () => {
  const uiFile = path.resolve(__dirname, '../../src/app/(admin)/admin/ui.tsx');
  const reportsFile = path.resolve(__dirname, '../../src/app/(admin)/admin/reports/page.tsx');

  const uiContent = fs.readFileSync(uiFile, 'utf-8');
  const reportsContent = fs.readFileSync(reportsFile, 'utf-8');

  it('verifies the order domain exports exactly 12 OrderStatus values', () => {
    expect(ORDER_STATUSES).toHaveLength(12);
    expect(ORDER_STATUSES).toContain('CLOSED');
    expect(ORDER_STATUSES).toContain('CLOSED_UNDELIVERED');
    expect(ORDER_STATUSES).toContain('CANCELLED_BY_STORE');
    expect(ORDER_STATUSES).toContain('DELIVERED');
  });

  it('verifies OrderStatusBadge maps all 12 domain statuses in ORDER_STATUS_STYLES', () => {
    expect(uiContent).toContain("import type { OrderStatus } from '@/modules/orders'");
    expect(uiContent).toContain('ORDER_STATUS_STYLES: Readonly<Record<OrderStatus, string>>');

    for (const status of ORDER_STATUSES) {
      expect(
        uiContent.includes(`${status}:`),
        `ui.tsx ORDER_STATUS_STYLES must define style for ${status}`,
      ).toBe(true);
    }
  });

  it('verifies CLOSED and CLOSED_UNDELIVERED are present in OrderStatusBadge', () => {
    expect(uiContent).toMatch(/CLOSED:\s*'bg-emerald/);
    expect(uiContent).toMatch(/CLOSED_UNDELIVERED:\s*'bg-rose/);
  });

  it('rejects fictitious statuses from ui.tsx and reports/page.tsx', () => {
    expect(uiContent).not.toContain('CANCELLED_BY_CUSTOMER');
    expect(uiContent).not.toContain('REFUNDED');
    expect(reportsContent).not.toContain('CANCELLED_BY_CUSTOMER');
    expect(reportsContent).not.toContain('REFUNDED');
  });

  it('verifies reports/page.tsx classifies pipeline roles using ACTIONABLE_ORDER_STATUSES', () => {
    expect(reportsContent).toContain('ACTIONABLE_ORDER_STATUSES');

    const actionable = new Set(ACTIONABLE_ORDER_STATUSES);
    expect(actionable.has('CLOSED')).toBe(false);
    expect(actionable.has('CLOSED_UNDELIVERED')).toBe(false);
    expect(actionable.has('CANCELLED_BY_STORE')).toBe(false);
    expect(actionable.has('DELIVERED')).toBe(false);

    // Active operational queue
    const activeStates: OrderStatus[] = [
      'PLACED',
      'ACCEPTED',
      'PICKING',
      'PICKED',
      'BILLED_IN_POS',
      'PACKED',
      'OUT_FOR_DELIVERY',
      'DELIVERY_FAILED',
    ];
    for (const state of activeStates) {
      expect(actionable.has(state), `${state} must be in actionable queue`).toBe(true);
    }
  });
});

describe('adminHref query parameter preservation (R1 / M2 regression guard)', () => {
  it('returns href unchanged when storeId is null, undefined, or empty', () => {
    expect(adminHref('/admin', null)).toBe('/admin');
    expect(adminHref('/admin', undefined)).toBe('/admin');
    expect(adminHref('/admin', '')).toBe('/admin');
    expect(adminHref('/admin/products?q=tea', null)).toBe('/admin/products?q=tea');
  });

  it('appends store query param when absent', () => {
    expect(adminHref('/admin', 'store-123')).toBe('/admin?store=store-123');
    expect(adminHref('/admin/orders', 'store-123')).toBe('/admin/orders?store=store-123');
  });

  it('preserves other existing query parameters', () => {
    expect(adminHref('/admin/products?edit=p1&q=tea', 'store-123')).toBe(
      '/admin/products?edit=p1&q=tea&store=store-123',
    );
    expect(adminHref('/admin/orders?all=1', 'store-123')).toBe(
      '/admin/orders?all=1&store=store-123',
    );
  });

  it('preserves existing store query parameter if already set', () => {
    expect(adminHref('/admin/orders?store=custom-store', 'store-123')).toBe(
      '/admin/orders?store=custom-store',
    );
  });

  it('preserves url fragments / hashes', () => {
    expect(adminHref('/admin#summary', 'store-123')).toBe('/admin?store=store-123#summary');
    expect(adminHref('/admin/orders?all=1#top', 'store-123')).toBe(
      '/admin/orders?all=1&store=store-123#top',
    );
  });
});

describe('navigationFor role access and information architecture (R2 / M4 regression guard)', () => {
  it('returns exactly 10 navigation items for STORE_STAFF', () => {
    const items = navigationFor('STORE_STAFF');
    expect(items).toEqual([
      { href: '/admin', label: 'Overview' },
      { href: '/admin/orders', label: 'Orders' },
      { href: '/admin/inventory', label: 'Inventory' },
      { href: '/admin/listings', label: 'Listings & prices' },
      { href: '/admin/products', label: 'Products' },
      { href: '/admin/zones', label: 'Delivery areas' },
      { href: '/admin/stores', label: 'Stores & settings' },
      { href: '/admin/two-factor', label: 'Two-factor auth' },
      { href: '/admin/fulfillment', label: 'Fulfillment' },
      { href: '/admin/pos', label: 'POS Integration' },
    ]);
  });

  it('returns exactly 13 navigation items for STORE_MANAGER', () => {
    const items = navigationFor('STORE_MANAGER');
    expect(items).toEqual([
      { href: '/admin', label: 'Overview' },
      { href: '/admin/orders', label: 'Orders' },
      { href: '/admin/inventory', label: 'Inventory' },
      { href: '/admin/listings', label: 'Listings & prices' },
      { href: '/admin/products', label: 'Products' },
      { href: '/admin/zones', label: 'Delivery areas' },
      { href: '/admin/stores', label: 'Stores & settings' },
      { href: '/admin/two-factor', label: 'Two-factor auth' },
      { href: '/admin/fulfillment', label: 'Fulfillment' },
      { href: '/admin/pos', label: 'POS Integration' },
      { href: '/admin/users', label: 'Users' },
      { href: '/admin/audit', label: 'Audit log' },
      { href: '/admin/reports', label: 'Reports & KPIs' },
    ]);
  });

  it('returns exactly 14 navigation items for SUPER_ADMIN', () => {
    const items = navigationFor('SUPER_ADMIN');
    expect(items).toEqual([
      { href: '/admin', label: 'Overview' },
      { href: '/admin/orders', label: 'Orders' },
      { href: '/admin/inventory', label: 'Inventory' },
      { href: '/admin/listings', label: 'Listings & prices' },
      { href: '/admin/products', label: 'Products' },
      { href: '/admin/zones', label: 'Delivery areas' },
      { href: '/admin/stores', label: 'Stores & settings' },
      { href: '/admin/two-factor', label: 'Two-factor auth' },
      { href: '/admin/fulfillment', label: 'Fulfillment' },
      { href: '/admin/pos', label: 'POS Integration' },
      { href: '/admin/users', label: 'Users' },
      { href: '/admin/audit', label: 'Audit log' },
      { href: '/admin/reports', label: 'Reports & KPIs' },
      { href: '/admin/categories', label: 'Categories' },
    ]);
  });
});

describe('Admin Reports and Overview real aggregates integrity (M1 regression guard)', () => {
  const reportsFile = path.resolve(__dirname, '../../src/app/(admin)/admin/reports/page.tsx');
  const overviewFile = path.resolve(__dirname, '../../src/app/(admin)/admin/page.tsx');

  const reportsContent = fs.readFileSync(reportsFile, 'utf-8');
  const overviewContent = fs.readFileSync(overviewFile, 'utf-8');

  it('verifies reports/page.tsx calls orderCounts and does NOT call orderQueue', () => {
    expect(reportsContent).toContain('orderCounts');
    expect(reportsContent).not.toContain('orderQueue');
  });

  it('verifies reports/page.tsx derives totals and price variances from exact counts', () => {
    expect(reportsContent).toContain('value={counts.total}');
    expect(reportsContent).toContain('value={counts.priceVarianceFlagged}');
    expect(reportsContent).toContain('counts.total > 0');
  });

  it('verifies reports/page.tsx iterates ORDER_STATUSES against counts.byStatus', () => {
    expect(reportsContent).toContain('ORDER_STATUSES.map');
    expect(reportsContent).toContain('counts.byStatus[status]');
    expect(reportsContent).toContain('counts.flaggedByStatus[status]');
  });

  it('verifies overview/page.tsx uses storeCounts.active instead of counting store rows', () => {
    expect(overviewContent).toContain('view.storeCounts.active');
    expect(overviewContent).not.toContain('view.stores.filter');
    expect(overviewContent).not.toContain('view.stores.length');
  });

  it('verifies overview/page.tsx derives actionable order count from orderCounts', () => {
    expect(overviewContent).toContain('orderCounts(principal, view.storeId)');
    expect(overviewContent).toContain('ACTIONABLE_ORDER_STATUSES.reduce');
  });

  it('verifies overview/page.tsx never swallows orderCounts failures into numeral 0 (R4 / M1)', () => {
    expect(overviewContent).not.toMatch(/orderCounts[^;]*\.catch\(\s*\(\)\s*=>\s*(null|0)/);
    expect(overviewContent).toContain("actionableOrderCount = 'Unavailable'");
    expect(overviewContent).toContain('orderCountUnavailable = true');
    expect(overviewContent).toContain('Reading temporarily unavailable');
    expect(overviewContent).toMatch(/orderCountUnavailable\s*\?\s*['"]rose['"]/);
  });
});
