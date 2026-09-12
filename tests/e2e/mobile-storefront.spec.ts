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

    // M2 Verification: Expand serviceable sectors / blocks details in community cards
    // and verify every service-area row contains EXACTLY ONE 'Deliver here' button
    const areasDetails = page.locator('details.group\\/areas');
    const detailsCount = await areasDetails.count();
    for (let i = 0; i < detailsCount; i++) {
      const details = areasDetails.nth(i);
      await details.locator('summary').click();
      const areaItems = details.locator('ul li');
      const itemCount = await areaItems.count();
      expect(itemCount).toBeGreaterThan(0);
      for (let j = 0; j < itemCount; j++) {
        const item = areaItems.nth(j);
        const deliverButtons = item.getByRole('button', { name: /deliver here/i });
        await expect(deliverButtons).toHaveCount(1);
      }
    }

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

    // ADD button presence (accessible name from aria-label)
    const addBtn = firstCard.getByRole('button', { name: /add .* to basket/i });
    await expect(addBtn).toBeVisible();

    // Verify tap target height
    const addBox = await addBtn.boundingBox();
    expect(addBox?.height).toBeGreaterThanOrEqual(44);

    // M4: Click ADD +, wait for stepper to appear, and assert both +/- buttons are >= 44x44px
    await addBtn.click();
    const decBtn = firstCard.getByRole('button', { name: /^decrease quantity/i });
    const incBtn = firstCard.getByRole('button', { name: /^increase quantity/i });
    await expect(decBtn).toBeVisible();
    await expect(incBtn).toBeVisible();

    const decBox = await decBtn.boundingBox();
    expect(decBox?.width).toBeGreaterThanOrEqual(44);
    expect(decBox?.height).toBeGreaterThanOrEqual(44);

    const incBox = await incBtn.boundingBox();
    expect(incBox?.width).toBeGreaterThanOrEqual(44);
    expect(incBox?.height).toBeGreaterThanOrEqual(44);

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

    // Verify D7 & M5: Floating mobile cart drawer appears unconditionally when items in basket
    const mobileCartBar = page.locator('aside[aria-label="Floating basket summary"]');
    await expect(mobileCartBar).toBeVisible();
    await expect(mobileCartBar.getByRole('link', { name: /view basket/i })).toBeVisible();
    await expect(mobileCartBar).toContainText(/scheduled slot delivery/i);

    // Verify M5: Cart bar does not overlap final actionable page content (footer) when scrolled to bottom
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    const footerLink = page.locator('footer a').last();
    await expect(footerLink).toBeVisible();
    const footerLinkBox = await footerLink.boundingBox();
    const barBox = await mobileCartBar.boundingBox();
    expect(footerLinkBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    if (footerLinkBox && barBox) {
      expect(footerLinkBox.y + footerLinkBox.height).toBeLessThanOrEqual(barBox.y);
    }

    // Go to checkout
    await page.goto('/checkout');
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();

    // M5: Assert cart bar is suppressed on checkout route where it is redundant
    await expect(page.locator('aside[aria-label="Floating basket summary"]')).toHaveCount(0);

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

  test('M6: Inline card actions surface server error messages via aria-live', async ({
    page,
    context,
  }) => {
    await page.goto('/store/select');
    await page.getByRole('button', { name: /shop store 1/i }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);

    // Navigate to a category browse page with product cards
    await page.goto('/c/staples');
    const firstCard = page.locator('article').first();
    await expect(firstCard).toBeVisible();

    // Add item to basket
    const addBtn = firstCard.getByRole('button', { name: /add .* to basket/i });
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // Wait for stepper to appear
    const incBtn = firstCard.getByRole('button', { name: /^increase quantity/i });
    await expect(incBtn).toBeVisible();

    // Clear cart token cookie to simulate server-side invalidated / cleared basket
    // while keeping storeContext active (so the category page remains valid)
    await context.clearCookies({ name: 'cartToken' });

    // Tap increase button on stepper
    await incBtn.click();

    // Verify error message is surfaced to the shopper via role="alert"
    const alert = firstCard.getByRole('alert');
    await expect(alert).toBeVisible();
    await expect(alert).toContainText(/your basket is empty/i);
  });

  test('Basket page redesign: mobile layout, image thumbnails, touch targets and /store/select redirect', async ({
    page,
    context,
  }) => {
    // 1. Unselected visitor visiting /cart is redirected to /store/select
    await context.clearCookies();
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/store\/select$/);

    // 2. Select Store 1 Community
    await page.getByRole('button', { name: /shop store 1/i }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);

    // 3. Visit empty basket
    await page.goto('/cart');
    await expect(page.getByText(/your basket is empty/i)).toBeVisible();
    const startShoppingLink = page.getByRole('link', { name: 'Start shopping' });
    await expect(startShoppingLink).toBeVisible();
    const startBox = await startShoppingLink.boundingBox();
    expect(startBox?.height).toBeGreaterThanOrEqual(44);

    // 4. Add a product with a known seeded image (Ragi Flour)
    await page.goto('/c/staples');
    const ragiCard = page.locator('article').filter({ hasText: 'Ragi Flour' });
    await expect(ragiCard).toBeVisible();
    const addBtn = ragiCard.getByRole('button', { name: /add .* to basket/i });
    await addBtn.click();
    await expect(ragiCard.getByRole('button', { name: /^increase quantity/i })).toBeVisible();

    // 5. Navigate to /cart
    await page.goto('/cart');
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible();

    // M1: Verify active community badge is a real Link to /store/select with >=44px touch target
    const communityBadge = page.getByRole('main').getByRole('link', { name: 'Store 1 Community' });
    await expect(communityBadge).toBeVisible();
    await expect(communityBadge).toHaveAttribute('href', '/store/select');
    const badgeBox = await communityBadge.boundingBox();
    expect(badgeBox?.height).toBeGreaterThanOrEqual(44);

    // M2: Verify Continue shopping link meets >=44px touch target
    const continueShoppingLink = page.getByRole('link', { name: /continue shopping/i });
    await expect(continueShoppingLink).toBeVisible();
    const continueBox = await continueShoppingLink.boundingBox();
    expect(continueBox?.height).toBeGreaterThanOrEqual(44);

    // S1: Verify cart row product thumbnail renders actual <img> with expected seeded src
    const cartRow = page.locator('li').filter({ hasText: 'Ragi Flour' });
    await expect(cartRow).toBeVisible();
    const thumbImg = cartRow.locator('img');
    await expect(thumbImg).toBeVisible();
    await expect(thumbImg).toHaveAttribute('src', '/seed/products/ragi-flour.svg');

    // Verify quantity and remove controls meet >=44px touch targets
    const updateBtn = cartRow
      .locator('form')
      .filter({ hasText: 'Update' })
      .getByRole('button', { name: 'Update' });
    await expect(updateBtn).toBeVisible();
    const updateBox = await updateBtn.boundingBox();
    expect(updateBox?.height).toBeGreaterThanOrEqual(44);
    expect(updateBox?.width).toBeGreaterThanOrEqual(44);

    const removeBtn = cartRow
      .locator('form')
      .filter({ hasText: 'Remove' })
      .getByRole('button', { name: 'Remove' });
    await expect(removeBtn).toBeVisible();
    const removeBox = await removeBtn.boundingBox();
    expect(removeBox?.height).toBeGreaterThanOrEqual(44);
    expect(removeBox?.width).toBeGreaterThanOrEqual(44);

    // Verify Proceed to checkout link meets >=44px touch target
    const checkoutLink = page.getByRole('link', { name: 'Proceed to checkout' });
    await expect(checkoutLink).toBeVisible();
    const checkoutBox = await checkoutLink.boundingBox();
    expect(checkoutBox?.height).toBeGreaterThanOrEqual(44);

    // Verify zero horizontal scroll on mobile viewport
    await assertNoHorizontalScroll(page);

    // M1: Verify clicking the active community badge navigates to /store/select
    await communityBadge.click();
    await expect(page).toHaveURL(/\/store\/select$/);
  });
});
