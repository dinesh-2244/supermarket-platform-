import { expect, test, type Page } from '@playwright/test';
import { getPrisma } from '@/modules/platform';
import type { OrderStatus } from '@/modules/orders';

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
  await signInWith(page, SEED_ADMIN, SEED_PASSWORD);
}

async function signInWith(page: Page, email: string, password = SEED_PASSWORD): Promise<void> {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
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

    // Verify touch targets on all sidebar links meet >=44px
    const navLinks = nav.locator('a');
    const navCount = await navLinks.count();
    for (let i = 0; i < navCount; i++) {
      const box = await navLinks.nth(i).boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

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
    const allHref = await allTab.getAttribute('href');
    await allTab.click();
    if (!page.url().includes('all=1') && allHref) {
      await page.goto(allHref);
    }
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

  test('M2: Store context persists across navigation and page link click-throughs for SUPER_ADMIN', async ({
    page,
  }) => {
    await signInAdmin(page);

    // 1. Overview: locate S2 in StoreSwitcher
    const s2Link = page.locator('main').getByRole('link', { name: /^S2 · / });
    await expect(s2Link).toBeVisible();
    const s2Href = await s2Link.getAttribute('href');
    expect(s2Href).toContain('store=');
    const s2Id = new URL(s2Href!, 'http://localhost').searchParams.get('store');
    expect(s2Id).toBeTruthy();

    await page.goto(s2Href!);
    await expect(page).toHaveURL(new RegExp(`store=${s2Id}`));
    await expect(page.locator('main').getByRole('link', { name: /^S2 · / })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const openNavIfNeeded = async () => {
      const toggle = page.getByRole('button', { name: 'Toggle navigation menu' });
      if (await toggle.isVisible()) {
        await toggle.click();
        await expect(
          page.getByRole('navigation', { name: 'Back office navigation' }),
        ).toBeVisible();
      }
    };

    const nav = page.getByRole('navigation', { name: 'Back office navigation' });

    // Verify all sidebar navigation links retain ?store=
    await openNavIfNeeded();
    await expect(nav.getByRole('link', { name: 'Orders', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`/admin/orders\\?store=${s2Id}`),
    );
    await expect(nav.getByRole('link', { name: 'Inventory', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`/admin/inventory\\?store=${s2Id}`),
    );
    await expect(nav.getByRole('link', { name: 'Listings & prices', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`/admin/listings\\?store=${s2Id}`),
    );
    await expect(nav.getByRole('link', { name: 'Stores & settings', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`/admin/stores\\?store=${s2Id}`),
    );
    await expect(nav.getByRole('link', { name: 'Overview', exact: true })).toHaveAttribute(
      'href',
      new RegExp(`/admin\\?store=${s2Id}`),
    );

    // Verify Overview KPI card links retain ?store=
    await expect(page.getByRole('link', { name: /Actionable orders/ })).toHaveAttribute(
      'href',
      new RegExp(`/admin/orders\\?store=${s2Id}`),
    );
    await expect(page.getByRole('link', { name: /Low stock items/ })).toHaveAttribute(
      'href',
      new RegExp(`/admin/inventory\\?store=${s2Id}`),
    );
    await expect(page.getByRole('link', { name: /Listed products/ })).toHaveAttribute(
      'href',
      new RegExp(`/admin/listings\\?store=${s2Id}`),
    );
    await expect(page.getByRole('link', { name: /Operating stores/ })).toHaveAttribute(
      'href',
      new RegExp(`/admin/stores\\?store=${s2Id}`),
    );

    // Click-through non-nav link 1: Overview Two-factor link
    const twoFactorLink = page.getByRole('link', {
      name: /Set up two-factor authentication|Manage two-factor authentication/,
    });
    await expect(twoFactorLink).toBeVisible();
    await twoFactorLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/two-factor\\?store=${s2Id}`));
    await expect(page.getByRole('heading', { name: 'Two-Factor Authentication' })).toBeVisible();

    // Click-through non-nav link 2: Products list -> edit product link
    await page.goto(`/admin/products?store=${s2Id}`);
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    const editLink = page.locator('main').getByRole('link', { name: 'edit' }).first();
    await expect(editLink).toBeVisible();
    await editLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/products\\?edit=[^&]+&store=${s2Id}`));
    await expect(page.getByRole('heading', { name: /^Edit / })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save product' })).toBeVisible();

    // Click-through non-nav link 3: Orders queue -> View details -> Back to queue
    await page.goto(`/admin/orders?store=${s2Id}`);
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
    await expect(page.locator('main').getByRole('link', { name: /^S2 · / })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const viewDetailsLink = page
      .locator('main')
      .getByRole('link', { name: 'View details →' })
      .first();
    await expect(viewDetailsLink).toBeVisible();
    await viewDetailsLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders/[^?]+\\?store=${s2Id}`));
    await expect(page.getByRole('heading', { name: 'Order details', exact: true })).toBeVisible();

    // Click Back to queue
    const backLink = page.getByRole('link', { name: /Back to queue/ });
    await expect(backLink).toBeVisible();
    await backLink.click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders\\?store=${s2Id}`));

    // Click filter tabs
    await page.getByRole('link', { name: 'All orders' }).click();
    await expect(page).toHaveURL(new RegExp(`store=${s2Id}`));
    await expect(page).toHaveURL(/all=1/);
    await page.getByRole('link', { name: /Actionable/ }).click();
    await expect(page).toHaveURL(`/admin/orders?store=${s2Id}`);

    // Click-through non-nav link 4: Fulfillment reserved slot -> View orders queue
    await page.goto(`/admin/fulfillment?store=${s2Id}`);
    await expect(page.getByRole('heading', { name: 'Fulfillment', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'View orders queue →' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders\\?store=${s2Id}`));

    // Click-through non-nav link 5: POS Integration reserved slot -> Go to orders queue
    await page.goto(`/admin/pos?store=${s2Id}`);
    await expect(page.getByRole('heading', { name: 'POS Integration', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Go to orders queue →' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders\\?store=${s2Id}`));

    // Click-through non-nav link 6: Reports & KPIs -> Open orders queue
    await page.goto(`/admin/reports?store=${s2Id}`);
    await expect(page.getByRole('heading', { name: 'Reports & KPIs', exact: true })).toBeVisible();
    await expect(page.locator('main').getByRole('link', { name: /^S2 · / })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByRole('link', { name: 'Open orders queue →' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/orders\\?store=${s2Id}`));

    // Click-through non-nav link 7 (R3/M2): Audit log -> filter form preserves store
    await openNavIfNeeded();
    await nav.getByRole('link', { name: 'Audit log', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/audit\\?store=${s2Id}`));
    await expect(page.getByRole('heading', { name: 'Audit log', exact: true })).toBeVisible();

    await page.getByLabel('Entity type').fill('Order');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/audit\\?.*store=${s2Id}`));
    await expect(page).toHaveURL(/entityType=Order/);

    // Clear filter link clears entityType while retaining store
    const clearLink = page.getByRole('link', { name: 'clear' });
    await expect(clearLink).toBeVisible();
    await clearLink.click();
    await expect(page).toHaveURL(`/admin/audit?store=${s2Id}`);
  });

  test('M4: Exact role-gated navigation links per navigationFor()', async ({ page }) => {
    const STAFF_EXPECTED = [
      'Overview',
      'Orders',
      'Inventory',
      'Listings & prices',
      'Products',
      'Delivery areas',
      'Stores & settings',
      'Two-factor auth',
      'Fulfillment',
      'POS Integration',
    ];
    const MANAGER_EXPECTED = [
      'Overview',
      'Orders',
      'Inventory',
      'Listings & prices',
      'Products',
      'Delivery areas',
      'Stores & settings',
      'Users',
      'Audit log',
      'Reports & KPIs',
      'Two-factor auth',
      'Fulfillment',
      'POS Integration',
    ];
    const SUPER_EXPECTED = [
      'Overview',
      'Orders',
      'Inventory',
      'Listings & prices',
      'Products',
      'Categories',
      'Delivery areas',
      'Stores & settings',
      'Users',
      'Audit log',
      'Reports & KPIs',
      'Two-factor auth',
      'Fulfillment',
      'POS Integration',
    ];

    const openNavIfNeeded = async () => {
      const toggle = page.getByRole('button', { name: 'Toggle navigation menu' });
      if (await toggle.isVisible()) {
        await toggle.click();
        await expect(
          page.getByRole('navigation', { name: 'Back office navigation' }),
        ).toBeVisible();
      }
    };

    const getNavLabels = async (): Promise<string[]> => {
      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
      await openNavIfNeeded();
      const nav = page.getByRole('navigation', { name: 'Back office navigation' });
      await expect(nav.locator('a').first()).toBeVisible();
      const links = nav.locator('a');
      const count = await links.count();
      const labels: string[] = [];
      for (let i = 0; i < count; i++) {
        const labelSpan = links.nth(i).locator('div > span:last-child');
        const text =
          (await labelSpan.count()) > 0
            ? await labelSpan.innerText()
            : await links.nth(i).innerText();
        const line = text.split('\n')[0]?.trim();
        if (line) labels.push(line);
      }
      return labels;
    };

    // 1. STORE_STAFF (10 items)
    await signInWith(page, 'staff.s1@munderfresh.local');
    const staffLabels = await getNavLabels();
    expect(staffLabels).toEqual(STAFF_EXPECTED);
    for (const forbidden of ['Users', 'Audit log', 'Reports & KPIs', 'Categories']) {
      expect(staffLabels).not.toContain(forbidden);
    }
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/admin\/sign-in/);

    // 2. STORE_MANAGER (13 items)
    await signInWith(page, 'manager.s1@munderfresh.local');
    const managerLabels = await getNavLabels();
    expect(managerLabels).toEqual(MANAGER_EXPECTED);
    expect(managerLabels).not.toContain('Categories');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/admin\/sign-in/);

    // 3. SUPER_ADMIN (14 items)
    await signInWith(page, SEED_ADMIN);
    const superLabels = await getNavLabels();
    expect(superLabels).toEqual(SUPER_EXPECTED);
  });

  test('M1: Reports displays true order aggregates exceeding 200-row queue cap and overview displays active store counts', async ({
    page,
  }) => {
    await signInAdmin(page);

    const prisma = getPrisma();
    const store = await prisma.store.findFirstOrThrow({ where: { code: 'S2' } });
    const customer = await prisma.customer.findFirstOrThrow();

    // Seed >200 orders (205 orders) directly into store S2 to reproduce Oscar's M1 condition
    const stamp = `m1-${Date.now().toString(36)}`;
    const getStatus = (i: number): OrderStatus => {
      if (i < 200) return 'PLACED';
      if (i < 203) return 'DELIVERED';
      return 'CANCELLED_BY_STORE';
    };
    const ordersData = Array.from({ length: 205 }, (_, i) => ({
      orderNumber: `M1-${stamp}-${String(i + 1).padStart(4, '0')}`,
      trackingToken: `tok-${stamp}-${i + 1}`,
      customerId: customer.id,
      storeId: store.id,
      status: getStatus(i),
      priceVarianceFlagged: i === 0 || i === 1,
      contactNameSnapshot: 'M1 Reporter',
      contactPhoneSnapshot: '9888877777',
      deliveryAddressSnapshotJson: { locality: 'Koramangala' },
      deliverySlotStart: new Date('2026-12-05T10:00:00Z'),
      deliverySlotEnd: new Date('2026-12-05T11:00:00Z'),
      paymentMethod: 'COD' as const,
      subtotalPaise: 5000,
      deliveryFeePaise: 1000,
      estimatedTotalPaise: 6000,
    }));

    await prisma.order.createMany({ data: ordersData });

    try {
      // 1. Reports page displays true aggregate total (>200) instead of capped 200-row queue
      await page.goto(`/admin/reports?store=${store.id}`);
      await expect(
        page.getByRole('heading', { name: 'Reports & KPIs', exact: true }),
      ).toBeVisible();

      const expectedTotal = await prisma.order.count({ where: { storeId: store.id } });
      expect(expectedTotal).toBeGreaterThanOrEqual(205);

      const totalOrdersCard = page.getByRole('link', { name: /Total store orders/ });
      await expect(totalOrdersCard).toBeVisible();
      await expect(totalOrdersCard).toContainText(String(expectedTotal));

      // 2. Price variances card shows exact flagged count
      const expectedVariance = await prisma.order.count({
        where: { storeId: store.id, priceVarianceFlagged: true },
      });
      const varianceCard = page.getByRole('link', { name: /Price variances/ });
      await expect(varianceCard).toBeVisible();
      await expect(varianceCard).toContainText(String(expectedVariance));

      // 3. Pipeline breakdown displays status rows with percentage of real total
      await expect(page.getByText('Order pipeline breakdown')).toBeVisible();
      await expect(page.getByText('PLACED', { exact: true })).toBeVisible();

      // 4. Overview page displays active store counts from storeCounts
      await page.goto('/admin');
      const activeStoresCount = await prisma.store.count({ where: { isActive: true } });
      const operatingStoresCard = page.getByRole('link', { name: /Operating stores/ });
      await expect(operatingStoresCard).toBeVisible();
      await expect(operatingStoresCard).toContainText(String(activeStoresCount));
    } finally {
      await prisma.order.deleteMany({
        where: { trackingToken: { startsWith: `tok-${stamp}` } },
      });
    }
  });

  test('R4/M1: Overview displays explicit Unavailable state and never numeral 0 when orderCounts fails', async ({
    page,
  }) => {
    await signInAdmin(page);

    const prisma = getPrisma();

    // Reproduce Oscar's live failure test: break the order query by renaming the table
    await prisma.$executeRawUnsafe('ALTER TABLE "Order" RENAME TO "Order_simulated_failure"');

    try {
      await page.goto('/admin');
      await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();

      // Actionable orders card MUST NOT display numeral 0; it must display "Unavailable"
      const actionableCard = page.getByRole('link', { name: /Actionable orders/ });
      await expect(actionableCard).toBeVisible();
      await expect(actionableCard).toContainText('Unavailable');
      await expect(actionableCard).toContainText('Reading temporarily unavailable');
      await expect(actionableCard).not.toContainText(/\b0\b/);

      // Other cards on overview (e.g. Operating stores) still function and display
      const operatingStoresCard = page.getByRole('link', { name: /Operating stores/ });
      await expect(operatingStoresCard).toBeVisible();
    } finally {
      // Restore the table immediately
      await prisma
        .$executeRawUnsafe('ALTER TABLE "Order_simulated_failure" RENAME TO "Order"')
        .catch(() => null);
    }

    // Verify recovery after restoration
    await page.goto('/admin');
    const recoveredCard = page.getByRole('link', { name: /Actionable orders/ });
    await expect(recoveredCard).toBeVisible();
    await expect(recoveredCard).not.toContainText('Unavailable');
  });
});
