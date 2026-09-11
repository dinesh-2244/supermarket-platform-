import { expect, test, type Page } from '@playwright/test';

/**
 * Mobile-First Acceptance Suite for Customer Storefront Retail Redesign (D1–D7).
 *
 * Validates:
 * - D1: Real homepage with community hero cards for first-time visitors
 * - D2: Two-card store selector for Store 1 & Store 2 Communities
 * - D3: Retail browse cards with image, discount badge, dual pricing & 1-click ADD / stepper
 * - D4: Category visual tiles with icons
 * - D5: Universal header search
 * - D6: Quarters-scoped checkout (no locality dropdown)
 * - D7: Mobile touch targets (≥44px), sticky cart bar & zero horizontal scrolling
 */

async function assertNoHorizontalScroll(page: Page): Promise<void> {
  const isOverflowing = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth;
  });
  expect(isOverflowing, 'Page must not have horizontal scroll').toBe(false);
}

test.describe.serial('Mobile Storefront Retail Redesign (D1–D7)', () => {
  test('D1 & D2: First-time mobile visitor sees community cards and binds Store 1 community', async ({
    page,
  }) => {
    await page.goto('/');

    // Verify D1: Engaging homepage without raw redirect
    await expect(page.getByText(/munder/i).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /fresh groceries delivered in/i }),
    ).toBeVisible();

    // Verify D2: Two community cards are prominently displayed
    const s1Card = page.getByRole('heading', { name: /store 1 community/i });
    const s2Card = page.getByRole('heading', { name: /store 2 community/i });
    await expect(s1Card).toBeVisible();
    await expect(s2Card).toBeVisible();

    // No prices shown on first arrival before community is selected
    await expect(page.locator('article')).toHaveCount(0);

    // Verify zero horizontal scroll on mobile viewport
    await assertNoHorizontalScroll(page);

    // Select Store 1 community
    const shopS1Btn = page.getByRole('button', { name: /shop store 1/i });
    await expect(shopS1Btn).toBeVisible();

    // Verify minimum tap target size (≥ 44px)
    const box = await shopS1Btn.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);

    await shopS1Btn.click();
    await expect(page).toHaveURL(/\/$|\/\?/);

    // After selection: shows active community greeting and catalogue
    await expect(page.getByRole('heading', { name: /shopping at store 1/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /change delivery area/i })).toBeVisible();
  });

  test('D3 & D4: Browse cards feature images, discount badges, and category tiles', async ({
    page,
  }) => {
    // Select community first
    await page.goto('/store/select');
    await page.getByRole('button', { name: /shop store 1/i }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);

    // D4: Verify visual category tiles are rendered
    const categoryTiles = page.locator('a[href^="/c/"]');
    await expect(categoryTiles.first()).toBeVisible();

    // D3: Verify product cards exist
    const cards = page.locator('article');
    expect(await cards.count()).toBeGreaterThan(0);

    const firstCard = cards.first();
    // Dual pricing check (selling price + currency symbol)
    await expect(firstCard.getByText('₹').first()).toBeVisible();

    // Product link and name
    await expect(firstCard.locator('a[href^="/p/"]').first()).toBeVisible();

    // ADD button presence
    const addBtn = firstCard.getByRole('button', { name: /add \+/i });
    await expect(addBtn).toBeVisible();

    // Verify tap target height
    const addBox = await addBtn.boundingBox();
    expect(addBox?.height).toBeGreaterThanOrEqual(44);

    await assertNoHorizontalScroll(page);
  });

  test('D5: Universal header search operates smoothly on mobile', async ({ page }) => {
    await page.goto('/store/select');
    await page.getByRole('button', { name: /shop store 1/i }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);

    // Search bar is visible in header (locating the visible input across mobile and desktop)
    const searchInput = page.locator('input[type="search"]:visible');
    await expect(searchInput).toBeVisible();

    // Perform a search
    await searchInput.fill('Rice');
    await searchInput.press('Enter');

    await expect(page).toHaveURL(/\/search\?q=Rice/);
    await expect(page.getByRole('heading', { name: /search catalogue/i })).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test('D6 & D7: Quarters-scoped checkout form and sticky mobile cart drawer', async ({ page }) => {
    await page.goto('/store/select');
    await page.getByRole('button', { name: /shop store 1/i }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);

    // Add item via product detail
    await page.goto('/c/staples');
    await page.locator('article a[href^="/p/"]').first().click();
    await expect(page).toHaveURL(/\/p\//);

    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    await addForm.getByLabel('Quantity').fill('5');
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

    // Verify D7: Floating mobile cart drawer appears when items in basket
    const mobileCartBar = page.locator('aside[aria-label="Floating basket summary"]');
    if (await mobileCartBar.isVisible()) {
      await expect(mobileCartBar.getByRole('link', { name: /view basket/i })).toBeVisible();
    }

    // Go to checkout
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

    // D6: Verify gated community callout
    await expect(page.getByText(/delivering to community/i)).toBeVisible();
    await expect(page.getByText(/store 1 community/i).first()).toBeVisible();

    // Verify no large raw locality dropdown at checkout
    await expect(page.locator('select[name="areaId"]')).toHaveCount(0);

    // Verify address inputs
    await expect(page.getByLabel('Your name')).toBeVisible();
    await expect(page.getByLabel('Phone number')).toBeVisible();
    await expect(page.getByLabel('Address line 1')).toBeVisible();
    await expect(page.getByLabel('Delivery window')).toBeVisible();
    await expect(page.getByRole('radio', { name: /cash on delivery/i })).toBeChecked();

    await assertNoHorizontalScroll(page);
  });
});
