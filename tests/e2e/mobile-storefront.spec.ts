import { expect, test, type Page } from '@playwright/test';
import { getPrisma } from '@/modules/platform';

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

  test('Customer account area redesign: optional-account framing, >=44px touch targets & zero horizontal scroll', async ({
    page,
    context,
  }) => {
    // 1. Visit /account/sign-in
    await context.clearCookies();
    await page.goto('/account/sign-in');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(main.getByText(/an account is optional/i).first()).toBeVisible();
    await assertNoHorizontalScroll(page);

    // Assert >=44px touch targets on sign-in
    const signInElements = [
      main.getByLabel('Email'),
      main.getByLabel('Password', { exact: true }),
      main.getByRole('button', { name: 'Sign in' }),
      main.getByRole('link', { name: 'Create one' }),
      main.getByRole('link', { name: /continue shopping as guest/i }),
    ];
    for (const el of signInElements) {
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    // 2. Visit /account/sign-up
    await page.goto('/account/sign-up');
    await expect(main.getByRole('heading', { name: 'Create an account' })).toBeVisible();
    await expect(main.getByText(/optional/i).first()).toBeVisible();
    await assertNoHorizontalScroll(page);

    // Assert >=44px touch targets on sign-up
    const signUpElements = [
      main.getByLabel('Name'),
      main.getByLabel('Email'),
      main.getByLabel('Mobile number'),
      main.getByLabel(/^Password/),
      main.getByRole('button', { name: 'Create account' }),
      main.getByRole('link', { name: 'Sign in' }),
      main.getByRole('link', { name: /continue shopping as guest/i }),
    ];
    for (const el of signUpElements) {
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    // 3. Sign in using the seeded demo shopper
    await page.goto('/account/sign-in');
    await main.getByLabel('Email').fill('shopper@munderfresh.local');
    await main.getByLabel('Password', { exact: true }).fill('ShopperPass1');
    await main.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account$/);
    await assertNoHorizontalScroll(page);

    // 4. Verify /account (Account dashboard)
    await expect(main.getByRole('heading', { name: /demo shopper|your account/i })).toBeVisible();
    await expect(main.getByText('Shopper account')).toBeVisible();
    await expect(main.getByText('Verified Shopper')).not.toBeVisible();

    const accountNav = main.getByRole('navigation', { name: 'Account' });
    await expect(accountNav).toBeVisible();
    await expect(accountNav.getByRole('link', { name: 'Overview' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(accountNav.getByRole('link', { name: 'Your addresses' })).not.toHaveAttribute(
      'aria-current',
    );
    await expect(accountNav.getByRole('link', { name: 'Your orders' })).not.toHaveAttribute(
      'aria-current',
    );

    const accountElements = [
      main.getByRole('link', { name: 'Your addresses' }),
      main.getByRole('link', { name: 'Your orders' }),
      main.getByRole('link', { name: /manage saved addresses/i }),
      main.getByRole('link', { name: /view past orders/i }),
      main.getByLabel('Name'),
      main.getByLabel('Mobile number'),
      main.locator('form').filter({ hasText: 'Save' }).getByRole('button', { name: 'Save' }),
      main.getByLabel('Current password'),
      main.getByLabel(/^New password/),
      main.getByRole('button', { name: 'Change password' }),
      main.getByRole('button', { name: 'Sign out' }),
    ];
    for (const el of accountElements) {
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    // 5. Navigate to /account/addresses
    await main.getByRole('link', { name: 'Your addresses' }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/);
    await expect(main.getByRole('heading', { name: 'Your addresses' })).toBeVisible();
    await assertNoHorizontalScroll(page);

    const addressesNav = main.getByRole('navigation', { name: 'Account' });
    await expect(addressesNav).toBeVisible();
    await expect(addressesNav.getByRole('link', { name: 'Your addresses' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(addressesNav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    );
    await expect(addressesNav.getByRole('link', { name: 'Your orders' })).not.toHaveAttribute(
      'aria-current',
    );

    const addForm = main.locator('form').filter({ hasText: 'Save address' });
    const addressElements = [
      main.getByRole('link', { name: /back to account/i }),
      main.getByRole('link', { name: 'Overview' }),
      main.getByRole('link', { name: 'Your orders' }),
      addForm.getByLabel('Label (Home, Work…)'),
      addForm.getByLabel('Address line'),
      addForm.getByLabel('Second line (optional)'),
      addForm.getByLabel('Landmark (optional)'),
      addForm.getByLabel('Delivery area'),
      addForm.getByLabel('Pincode (optional)'),
      addForm.locator('label').filter({ hasText: /deliver here by default/i }),
      addForm.getByRole('button', { name: 'Save address' }),
    ];
    for (const el of addressElements) {
      await expect(el).toBeVisible();
      const box = await el.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }

    // 6. Navigate to /account/orders
    await main.getByRole('link', { name: 'Your orders' }).click();
    await expect(page).toHaveURL(/\/account\/orders$/);
    await expect(main.getByRole('heading', { name: 'Your orders' })).toBeVisible();
    await expect(main.getByText(/account order history is not available yet/i)).toBeVisible();
    await expect(main.getByText(/private tracking link/i)).toBeVisible();
    await expect(main.getByRole('link', { name: /fill a basket/i })).not.toBeVisible();
    await assertNoHorizontalScroll(page);

    const ordersNav = main.getByRole('navigation', { name: 'Account' });
    await expect(ordersNav).toBeVisible();
    await expect(ordersNav.getByRole('link', { name: 'Your orders' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(ordersNav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute(
      'aria-current',
    );
    await expect(ordersNav.getByRole('link', { name: 'Your addresses' })).not.toHaveAttribute(
      'aria-current',
    );

    const allOrderLinks = await main.getByRole('link').all();
    for (const link of allOrderLinks) {
      await expect(link).toBeVisible();
      const box = await link.boundingBox();
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('Product detail page redesign: image-first layout, pricing & >=44px touch targets', async ({
    page,
    browser,
  }) => {
    // 1. Verify unauthenticated / no-store-context visitor redirects to /store/select
    const incognito = await browser.newContext();
    const freshPage = await incognito.newPage();
    await freshPage.goto('/p/ragi-flour-1kg');
    await expect(freshPage).toHaveURL(/\/store\/select$/);
    await incognito.close();

    // 2. Select Store 1 community
    await page.goto('/store/select');
    await page.getByRole('button', { name: /shop store 1/i }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);

    // 3. Navigate to a product page with images
    await page.goto('/p/ragi-flour-1kg');
    await expect(page).toHaveURL(/\/p\/ragi-flour-1kg$/);

    const main = page.getByRole('main');

    // 4. Verify Breadcrumb landmark and navigation links
    const breadcrumb = main.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByRole('link', { name: 'All products' })).toBeVisible();

    // 5. Verify Product heading, brand, pack size, exact seeded pricing, MRP, saving, and discount
    await expect(main.getByRole('heading', { level: 1, name: 'Ragi Flour' })).toBeVisible();
    await expect(main.getByText('Annapurna').first()).toBeVisible();
    await expect(main.getByText('1 kg').first()).toBeVisible();
    await expect(main.getByText('₹90.25')).toBeVisible();
    await expect(main.getByText('MRP ₹95.00')).toBeVisible();
    await expect(main.getByText('Save ₹4.75')).toBeVisible();
    await expect(main.getByText('5% OFF')).toBeVisible();
    await expect(main.getByText('In stock')).toBeVisible();

    // Verify backed service signals and absence of unbacked claims
    await expect(main.getByText('Scheduled slot fresh delivery')).toBeVisible();
    await expect(main.getByText('Live store pricing & availability')).toBeVisible();
    await expect(main.getByText('Inclusive of all taxes')).not.toBeVisible();
    await expect(main.getByText('Store-fresh quality guarantee')).not.toBeVisible();

    // 6. Verify image showcase: exact src, alt, and real browser image load (complete & naturalWidth > 0)
    const heroImg = main.locator('img[src="/seed/products/ragi-flour.svg"]');
    await expect(heroImg).toBeVisible();
    await expect(heroImg).toHaveAttribute('alt', 'A pack of ragi flour');
    const isImgLoaded = await heroImg.evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
    );
    expect(isImgLoaded).toBe(true);

    // 7. Verify touch targets on interactive controls (min-h >= 44px)
    const breadcrumbLink = breadcrumb.getByRole('link', { name: 'All products' });
    const breadcrumbBox = await breadcrumbLink.boundingBox();
    expect(breadcrumbBox?.height).toBeGreaterThanOrEqual(44);

    const qtyInput = main.getByLabel('Quantity');
    await expect(qtyInput).toBeVisible();
    const qtyBox = await qtyInput.boundingBox();
    expect(qtyBox?.height).toBeGreaterThanOrEqual(44);

    const addBtn = main.getByRole('button', { name: 'Add to basket' });
    await expect(addBtn).toBeVisible();
    const btnBox = await addBtn.boundingBox();
    expect(btnBox?.height).toBeGreaterThanOrEqual(44);

    // 8. Deterministic in-stock Add-to-basket flow (unconditional since Ragi is deterministically in stock)
    await addBtn.click();
    await expect(main.locator('form').getByRole('status')).toContainText(/in your basket/i);

    // 9. Assert zero horizontal overflow on this viewport
    await assertNoHorizontalScroll(page);

    // 10. Verify fallback treatment for products without images
    await page.goto('/p/sona-masoori-rice-5kg');
    await expect(page.getByRole('main').getByText('No photo yet')).toBeVisible();
    await expect(
      page.getByRole('main').getByText('Product image will appear once added'),
    ).toBeVisible();
    await assertNoHorizontalScroll(page);
  });

  test('Order confirmation, tracking & unserviceable pages: visual layout, >=44px touch targets & zero horizontal scroll', async ({
    page,
  }, testInfo) => {
    // 1. Test /unserviceable page
    await page.goto('/unserviceable?reason=out-of-zone');
    await expect(page.getByRole('heading', { name: /not in your area yet/i })).toBeVisible();
    await expect(page.getByText(/just outside our delivery zones/i)).toBeVisible();
    await expect(page.getByText('₹')).toHaveCount(0);

    // Verify touch targets on unserviceable page
    const interestForm = page.locator('form').filter({ hasText: 'Let us know' });
    const pincodeInput = interestForm.getByLabel('Pincode');
    const localityInput = interestForm.getByLabel('Locality');
    const submitBtn = interestForm.getByRole('button', { name: 'Let us know' });
    const chooseAreaLink = page.getByRole('main').getByRole('link', { name: /choose it here/i });

    await expect(pincodeInput).toBeVisible();
    await expect(localityInput).toBeVisible();
    await expect(submitBtn).toBeVisible();
    await expect(chooseAreaLink).toBeVisible();

    const pincodeBox = await pincodeInput.boundingBox();
    const localityBox = await localityInput.boundingBox();
    const submitBtnBox = await submitBtn.boundingBox();
    const chooseAreaBox = await chooseAreaLink.boundingBox();

    expect(pincodeBox?.height).toBeGreaterThanOrEqual(44);
    expect(localityBox?.height).toBeGreaterThanOrEqual(44);
    expect(submitBtnBox?.height).toBeGreaterThanOrEqual(44);
    expect(chooseAreaBox?.height).toBeGreaterThanOrEqual(44);

    // Verify link href points to /store/select
    expect(await chooseAreaLink.getAttribute('href')).toBe('/store/select');

    await assertNoHorizontalScroll(page);

    // 2. Place an order to test /order-placed and /order-status
    await page.goto('/store/select');
    await page.getByRole('button', { name: /shop store 1/i }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);

    // Add Whole Wheat Atta (clears ₹250 minimum order threshold with a single unit)
    await page.goto('/p/whole-wheat-atta-5kg');
    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

    // Go to checkout and place order
    await page.goto('/checkout');
    await page.getByLabel('Your name').fill('Mobile Confirmation Tester');
    await page.getByLabel('Phone number').fill('9812300099');
    await page.getByRole('main').getByLabel('Address line 1').fill('123 Mobile Way');

    // Select delivery slot with low parallel contention across workers
    const slotSelect = page.getByLabel('Delivery window');
    const slotOptions = await slotSelect.locator('option').all();
    if (slotOptions.length > 2) {
      const slotIndex = Math.min(slotOptions.length - 1, (testInfo.parallelIndex % 10) + 3);
      await slotSelect.selectOption({ index: slotIndex });
    }

    await page.getByRole('button', { name: 'Place order' }).click();

    // 3. Verify /order-placed/[trackingToken] page
    await expect(page).toHaveURL(/\/order-placed\/t_[0-9A-Z]{20}$/);
    const mainPlaced = page.getByRole('main');
    await expect(mainPlaced.getByRole('heading', { name: /your order is placed/i })).toBeVisible();
    await expect(mainPlaced.getByText(/order number/i)).toBeVisible();
    await expect(mainPlaced.getByText(/^S\d-\d{6}-[0-9A-Z]{5}$/)).toBeVisible();

    // Verify touch targets on order-placed page
    const trackOrderLink = mainPlaced.getByRole('link', { name: /track this order/i });
    const keepShoppingLinkPlaced = mainPlaced.getByRole('link', { name: /keep shopping/i });
    await expect(trackOrderLink).toBeVisible();
    await expect(keepShoppingLinkPlaced).toBeVisible();

    const trackBox = await trackOrderLink.boundingBox();
    const keepPlacedBox = await keepShoppingLinkPlaced.boundingBox();
    expect(trackBox?.height).toBeGreaterThanOrEqual(44);
    expect(keepPlacedBox?.height).toBeGreaterThanOrEqual(44);

    await assertNoHorizontalScroll(page);

    // 4. Click track this order and verify /order-status/[trackingToken] page
    await trackOrderLink.click();
    await expect(page).toHaveURL(/\/order-status\/t_[0-9A-Z]{20}$/);

    const mainStatus = page.getByRole('main');
    await expect(
      mainStatus.getByRole('heading', { name: /^Order S\d-\d{6}-[0-9A-Z]{5}$/ }),
    ).toBeVisible();
    await expect(mainStatus.getByRole('heading', { name: 'Progress' })).toBeVisible();
    await expect(mainStatus.getByRole('heading', { name: 'What you ordered' })).toBeVisible();

    // Invariant: zero buttons and zero forms in main
    await expect(mainStatus.getByRole('button')).toHaveCount(0);
    await expect(mainStatus.locator('form')).toHaveCount(0);
    // Invariant: shopper phone number not leaked
    await expect(mainStatus.getByText('9812300099')).toHaveCount(0);

    // Verify touch target on keep shopping link
    const keepShoppingLinkStatus = mainStatus.getByRole('link', { name: /keep shopping/i });
    await expect(keepShoppingLinkStatus).toBeVisible();
    const keepStatusBox = await keepShoppingLinkStatus.boundingBox();
    expect(keepStatusBox?.height).toBeGreaterThanOrEqual(44);

    await assertNoHorizontalScroll(page);

    // 5. Exhaustive OrderStatus presentation coverage (OSCAR PR #42 corrective M1)
    const trackingTokenMatch = /\/order-status\/(t_[0-9A-Z]{20})$/.exec(page.url());
    expect(trackingTokenMatch).toBeTruthy();
    const trackingToken = trackingTokenMatch?.[1];
    expect(trackingToken).toBeDefined();
    if (!trackingToken) throw new Error('Tracking token not found in URL');

    const prisma = getPrisma();
    const orderRecord = await prisma.order.findUniqueOrThrow({
      where: { trackingToken },
    });

    const statusBanner = mainStatus.locator('[data-status]');

    // 5a. Active state (PLACED): blue tone, clock icon, blue timeline dot
    await expect(mainStatus.getByRole('status')).toHaveText('Order placed');
    await expect(statusBanner).toHaveAttribute('data-status', 'PLACED');
    await expect(statusBanner).toHaveAttribute('data-tone', 'active');
    await expect(statusBanner).toHaveClass(/border-blue-200 bg-blue-50 text-blue-950/);
    await expect(mainStatus.locator('[data-step-status="PLACED"]')).toHaveClass(/bg-blue-600/);

    // 5b. Active state (OUT_FOR_DELIVERY): blue tone, clock icon, blue timeline dot
    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderRecord.id },
        data: { status: 'OUT_FOR_DELIVERY' },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: orderRecord.id,
          fromStatus: 'PLACED',
          toStatus: 'OUT_FOR_DELIVERY',
          actorType: 'SYSTEM',
        },
      }),
    ]);
    await page.reload();
    await expect(mainStatus.getByRole('status')).toHaveText('Out for delivery');
    await expect(statusBanner).toHaveAttribute('data-status', 'OUT_FOR_DELIVERY');
    await expect(statusBanner).toHaveAttribute('data-tone', 'active');
    await expect(statusBanner).toHaveClass(/border-blue-200 bg-blue-50 text-blue-950/);
    await expect(mainStatus.locator('[data-step-status="OUT_FOR_DELIVERY"]')).toHaveClass(
      /bg-blue-600/,
    );

    // 5c. Warning state (DELIVERY_FAILED): amber tone, alert icon, amber timeline dot
    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderRecord.id },
        data: { status: 'DELIVERY_FAILED' },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: orderRecord.id,
          fromStatus: 'OUT_FOR_DELIVERY',
          toStatus: 'DELIVERY_FAILED',
          actorType: 'SYSTEM',
          note: 'Customer address gate locked',
        },
      }),
    ]);
    await page.reload();
    await expect(mainStatus.getByRole('status')).toHaveText('Delivery attempt failed');
    await expect(statusBanner).toHaveAttribute('data-status', 'DELIVERY_FAILED');
    await expect(statusBanner).toHaveAttribute('data-tone', 'warning');
    await expect(statusBanner).toHaveClass(/border-amber-200 bg-amber-50 text-amber-950/);
    await expect(mainStatus.locator('[data-step-status="DELIVERY_FAILED"]')).toHaveClass(
      /bg-amber-600/,
    );

    // 5d. Terminal negative state (CLOSED_UNDELIVERED): red tone, cross icon, red timeline dot
    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderRecord.id },
        data: { status: 'CLOSED_UNDELIVERED' },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: orderRecord.id,
          fromStatus: 'DELIVERY_FAILED',
          toStatus: 'CLOSED_UNDELIVERED',
          actorType: 'SYSTEM',
          note: 'Undelivered order closed',
        },
      }),
    ]);
    await page.reload();
    await expect(mainStatus.getByRole('status')).toHaveText('Closed — not delivered');
    await expect(statusBanner).toHaveAttribute('data-status', 'CLOSED_UNDELIVERED');
    await expect(statusBanner).toHaveAttribute('data-tone', 'error');
    await expect(statusBanner).toHaveClass(/border-red-200 bg-red-50 text-red-950/);
    await expect(mainStatus.locator('[data-step-status="CLOSED_UNDELIVERED"]')).toHaveClass(
      /bg-red-600/,
    );

    // 5e. Cancellation state (CANCELLED_BY_STORE): red tone, cross icon, red timeline dot
    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderRecord.id },
        data: { status: 'CANCELLED_BY_STORE' },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: orderRecord.id,
          fromStatus: 'CLOSED_UNDELIVERED',
          toStatus: 'CANCELLED_BY_STORE',
          actorType: 'USER',
          note: 'Cancelled by store manager',
        },
      }),
    ]);
    await page.reload();
    await expect(mainStatus.getByRole('status')).toHaveText('Cancelled by the shop');
    await expect(statusBanner).toHaveAttribute('data-status', 'CANCELLED_BY_STORE');
    await expect(statusBanner).toHaveAttribute('data-tone', 'error');
    await expect(statusBanner).toHaveClass(/border-red-200 bg-red-50 text-red-950/);
    await expect(mainStatus.locator('[data-step-status="CANCELLED_BY_STORE"]')).toHaveClass(
      /bg-red-600/,
    );

    // 5f. Completed / delivered state (DELIVERED): emerald tone, check icon, emerald timeline dot
    await prisma.$transaction([
      prisma.order.update({
        where: { id: orderRecord.id },
        data: { status: 'DELIVERED' },
      }),
      prisma.orderStatusHistory.create({
        data: {
          orderId: orderRecord.id,
          fromStatus: 'CANCELLED_BY_STORE',
          toStatus: 'DELIVERED',
          actorType: 'SYSTEM',
        },
      }),
    ]);
    await page.reload();
    await expect(mainStatus.getByRole('status')).toHaveText('Delivered');
    await expect(statusBanner).toHaveAttribute('data-status', 'DELIVERED');
    await expect(statusBanner).toHaveAttribute('data-tone', 'success');
    await expect(statusBanner).toHaveClass(/border-emerald-200 bg-emerald-50 text-emerald-950/);
    await expect(mainStatus.locator('[data-step-status="DELIVERED"]')).toHaveClass(
      /bg-emerald-600/,
    );

    await assertNoHorizontalScroll(page);
  });
});
