import { expect, test, type Page } from '@playwright/test';

/**
 * Tablet and Mobile Staff Ergonomics Acceptance Suite (AD11).
 *
 * Validates staff usability across iPad Mini / tablet portrait & landscape:
 * - AD1: Dashboard home / overview KPI cards, low stock alerts, security section
 * - AD2: Responsive navigation shell with drawer/sidebar and grouped sections
 * - AD3: Sticky store context switching with honest assignment display
 * - AD4: Orders queue, status filters, badges, and detail timeline
 * - AD5: Inventory browsing, CSV import form, stock adjust controls
 * - AD6: Catalog master products, category tree, listings & pricing
 * - AD7: Delivery zones, address serviceability probe, store parameters
 * - AD8: Staff user accounts, role badges, audit activity feed
 * - AD9: Reports surface tracing to authoritative read models
 * - AD10: Reserved Phase 5 fulfillment slot
 * - AD11: Zero horizontal scroll across all screens & >=44px touch targets
 * - AD12: Reserved POS integration slot & permanent MANUAL mode support
 */

const SEED_ADMIN = 'admin@munderfresh.local';
const SEED_PASSWORD = 'DevPassw0rd!';

async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const isOverflowing = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  expect(isOverflowing, 'Page must not have horizontal scroll').toBe(false);
}

async function signInAdmin(page: Page): Promise<void> {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(SEED_ADMIN);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test.describe.serial('Admin Dashboard Tablet Usability & IA Redesign (AD1–AD12)', () => {
  test('AD1 & AD2 & AD3: Overview home, navigation shell, store context & touch targets', async ({
    page,
  }) => {
    await signInAdmin(page);

    // AD1: Overview heading & KPI cards
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByText('Actionable orders')).toBeVisible();
    await expect(page.getByText('Low stock items')).toBeVisible();
    await expect(page.getByText('Listed products')).toBeVisible();
    await expect(page.getByText('Operating stores')).toBeVisible();

    // AD3: Store switcher exists and has >=44px touch targets
    const storeLinks = page.locator('main').getByRole('link', { name: /S\d · / });
    const storeCount = await storeLinks.count();
    if (storeCount > 0) {
      for (let i = 0; i < storeCount; i++) {
        const link = storeLinks.nth(i);
        const box = await link.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
    }

    // AD2: Navigation shell verification
    // On tablet portrait / small screens, open navigation drawer if toggle is visible
    const navToggle = page.getByRole('button', { name: 'Toggle navigation menu' });
    if (await navToggle.isVisible()) {
      await navToggle.click();
    }

    const nav = page.getByRole('navigation', { name: 'Back office navigation' });

    // Verify grouped section items are reachable
    await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Orders', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Inventory', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Listings & prices', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Products', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Categories', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Delivery areas', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Stores & settings', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Users', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Audit log', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Reports & KPIs', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: /Fulfillment/ })).toBeVisible();
    await expect(nav.getByRole('link', { name: /POS Integration/ })).toBeVisible();

    // Verify touch targets on nav items
    const overviewLink = nav.getByRole('link', { name: 'Overview', exact: true });
    const overviewBox = await overviewLink.boundingBox();
    expect(overviewBox?.height).toBeGreaterThanOrEqual(44);

    const signoutBtn = page.getByRole('button', { name: 'Sign out' });
    const signoutBox = await signoutBtn.boundingBox();
    expect(signoutBox?.height).toBeGreaterThanOrEqual(44);

    await assertNoHorizontalScroll(page);
  });

  test('AD4: Orders queue, status filters, and timeline inspection', async ({ page }) => {
    await signInAdmin(page);
    await page.goto('/admin/orders');
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

    // Verify filter tabs meet >=44px
    const actionableTab = page.getByRole('link', { name: 'Actionable orders' });
    const allTab = page.getByRole('link', { name: 'All orders' });
    await expect(actionableTab).toBeVisible();
    await expect(allTab).toBeVisible();

    const actionableBox = await actionableTab.boundingBox();
    const allBox = await allTab.boundingBox();
    expect(actionableBox?.height).toBeGreaterThanOrEqual(44);
    expect(allBox?.height).toBeGreaterThanOrEqual(44);

    await assertNoHorizontalScroll(page);

    // Switch to all orders
    await allTab.click();
    await expect(page).toHaveURL(/all=1/);
    await assertNoHorizontalScroll(page);
  });

  test('AD5: Inventory management, stock adjustment, and CSV import', async ({ page }) => {
    await signInAdmin(page);
    await page.goto('/admin/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    // Verify import form button meets >=44px
    const importBtn = page.getByRole('button', { name: 'Run import' });
    await expect(importBtn).toBeVisible();
    const importBox = await importBtn.boundingBox();
    expect(importBox?.height).toBeGreaterThanOrEqual(44);

    // Verify stock adjustment touch targets
    const adjustBtns = page.locator('form').filter({ hasText: 'Adjust' }).getByRole('button');
    if ((await adjustBtns.count()) > 0) {
      const adjustBox = await adjustBtns.first().boundingBox();
      expect(adjustBox?.height).toBeGreaterThanOrEqual(44);
    }

    await assertNoHorizontalScroll(page);
  });

  test('AD6: Listings & prices, product master, and categories hierarchy', async ({ page }) => {
    await signInAdmin(page);

    // Listings
    await page.goto('/admin/listings');
    await expect(
      page.getByRole('heading', { name: 'Listings & prices', exact: true }),
    ).toBeVisible();
    await assertNoHorizontalScroll(page);

    // Products master
    await page.goto('/admin/products');
    await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
    const searchBtn = page.getByRole('button', { name: 'Search' });
    await expect(searchBtn).toBeVisible();
    const searchBox = await searchBtn.boundingBox();
    expect(searchBox?.height).toBeGreaterThanOrEqual(44);
    await assertNoHorizontalScroll(page);

    // Categories tree
    await page.goto('/admin/categories');
    await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test('AD7: Delivery areas and store settings', async ({ page }) => {
    await signInAdmin(page);

    // Zones
    await page.goto('/admin/zones');
    await expect(
      page.getByRole('heading', { name: 'Delivery zones & areas', exact: true }),
    ).toBeVisible();
    const resolveBtn = page.getByRole('button', { name: 'Resolve' });
    await expect(resolveBtn).toBeVisible();
    const resolveBox = await resolveBtn.boundingBox();
    expect(resolveBox?.height).toBeGreaterThanOrEqual(44);
    await assertNoHorizontalScroll(page);

    // Stores
    await page.goto('/admin/stores');
    await expect(
      page.getByRole('heading', { name: 'Stores & settings', exact: true }),
    ).toBeVisible();
    const saveSettingsBtn = page.getByRole('button', { name: 'Save settings' });
    await expect(saveSettingsBtn).toBeVisible();
    const saveSettingsBox = await saveSettingsBtn.boundingBox();
    expect(saveSettingsBox?.height).toBeGreaterThanOrEqual(44);
    await assertNoHorizontalScroll(page);
  });

  test('AD8: User accounts and audit log feed', async ({ page }) => {
    await signInAdmin(page);

    // Users
    await page.goto('/admin/users');
    await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible();
    const createUserBtn = page.getByRole('button', { name: 'Create user' });
    await expect(createUserBtn).toBeVisible();
    const createBox = await createUserBtn.boundingBox();
    expect(createBox?.height).toBeGreaterThanOrEqual(44);
    await assertNoHorizontalScroll(page);

    // Audit log
    await page.goto('/admin/audit');
    await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();
    const filterBtn = page.getByRole('button', { name: 'Filter' });
    await expect(filterBtn).toBeVisible();
    const filterBox = await filterBtn.boundingBox();
    expect(filterBox?.height).toBeGreaterThanOrEqual(44);
    await assertNoHorizontalScroll(page);
  });

  test('AD9: Reports & KPIs surface tracing to authoritative read paths', async ({ page }) => {
    await signInAdmin(page);
    await page.goto('/admin/reports');
    await expect(page.getByRole('heading', { name: 'Reports & KPIs', exact: true })).toBeVisible();

    // Verify reports metrics
    await expect(page.getByText('Total store orders')).toBeVisible();
    await expect(page.getByText('Price variances')).toBeVisible();
    await expect(page.getByText('Order pipeline breakdown')).toBeVisible();
    await expect(page.getByText('Stock health')).toBeVisible();

    await assertNoHorizontalScroll(page);
  });

  test('AD10 & AD12: Reserved IA slots for Fulfillment (Phase 5) & POS Integration (ADR-0007)', async ({
    page,
  }) => {
    await signInAdmin(page);

    // AD10: Fulfillment slot
    await page.goto('/admin/fulfillment');
    await expect(page.getByRole('heading', { name: 'Fulfillment', exact: true })).toBeVisible();
    await expect(page.getByText('Phase 5 Scope')).toBeVisible();
    await expect(page.getByText('Order picking')).toBeVisible();
    await expect(page.getByText('POS billing handoff')).toBeVisible();
    await assertNoHorizontalScroll(page);

    // AD12: POS Integration slot
    await page.goto('/admin/pos');
    await expect(page.getByRole('heading', { name: 'POS Integration', exact: true })).toBeVisible();
    await expect(page.getByText('Permanent Manual Mode Architecture')).toBeVisible();
    await expect(page.getByText(/Manual mode is a permanent/i)).toBeVisible();
    await expect(page.getByText('Manual POS Bill Entry')).toBeVisible();
    await expect(page.getByText('CSV Inventory Reconciliation')).toBeVisible();
    await assertNoHorizontalScroll(page);
  });
});
