import { expect, test, type Page } from '@playwright/test';

/**
 * P3-8 — the Phase 3 golden path, as one continuous story.
 *
 * A shopper arrives knowing nothing, says where they live, browses, searches,
 * opens a product, fills a basket, watches it revalidate, moves house to the
 * other shop's area, and finally creates an account — and the basket they built
 * with no account at all comes with them.
 *
 * The other specs check parts in isolation. This one exists because the parts
 * are correct and the *joins* between them are where a storefront actually
 * breaks: a cookie that is set but not read, a redirect that loses a basket, a
 * price that is right on one page and stale on the next.
 */
const run = Date.now().toString().slice(-6);
const email = `golden.${run}@example.test`;
const phone = `96${run.padStart(8, '0')}`;
const PASSWORD = 'GoldenPathPass1';

/** The seeded demo shopper, for the signed-in half of the story. */
const SEED_CUSTOMER = 'shopper@munderfresh.local';
const SEED_CUSTOMER_PASSWORD = 'ShopperPass1';

async function pickArea(page: Page, areaName: string): Promise<void> {
  await page.goto('/locality');
  await page
    .locator('form')
    .filter({ hasText: areaName })
    .getByRole('button', { name: 'Deliver here' })
    .click();
  await expect(page).toHaveURL(/\/$|\/\?/);
}

test('the whole of Phase 3, without ever being asked to sign in', async ({ page }) => {
  // 1. Arrive knowing nothing. The picker comes first — there is no default
  //    store, because every price on the site belongs to one specific shop.
  await page.goto('/');
  await expect(page).toHaveURL(/\/locality$/);

  // 2. Say where you live. A store is bound, and named.
  await pickArea(page, 'Jayanagar 4th Block');
  const shopHeading = page.getByRole('heading', { name: /shopping at/i });
  await expect(shopHeading).toBeVisible();
  const firstShop = (await shopHeading.textContent())?.trim() ?? '';

  // 3. Browse an aisle.
  await page.locator('a[href^="/c/"]').first().click();
  await expect(page).toHaveURL(/\/c\//);
  await expect(page.locator('article').first()).toBeVisible();

  // 4. Search this shop.
  const productName = (
    (await page.locator('article a[href^="/p/"]').first().textContent()) ?? ''
  ).trim();
  await page.goto(`/search?q=${encodeURIComponent(productName.split(' ')[0] ?? 'rice')}`);
  await expect(page.getByText(/result\(s\) for/i)).toBeVisible();

  // 5. Open a product. Price, availability and a breadcrumb, all this shop's.
  await page.locator('article a[href^="/p/"]').first().click();
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  await expect(page.getByText('₹').first()).toBeVisible();

  // 6. Fill a basket. No account has been asked for at any point.
  const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
  await addForm.getByLabel('Quantity').fill('3');
  await addForm.getByRole('button', { name: 'Add to basket' }).click();
  await expect(addForm.getByRole('status')).toContainText(/in your basket/i);
  await expect(page.getByLabel(/item\(s\) in your basket/i)).toHaveText('3');

  // 7. The basket revalidates on every look, and stops honestly at Phase 4.
  await page.goto('/cart');
  await expect(page.getByText(/subtotal \(3 item\(s\)\)/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Proceed to checkout' })).toBeDisabled();
  await expect(page.getByText(/checkout arrives in phase 4/i)).toBeVisible();

  // 8. Move to an area the *other* shop serves. The basket follows and is
  //    re-priced, with a summary of what came and what could not.
  await pickArea(page, 'Indiranagar 1st Stage');
  const secondShop = ((await shopHeading.textContent()) ?? '').trim();
  expect(secondShop).not.toBe(firstShop);

  await page.goto('/cart');
  await expect(page.getByRole('status').first()).toContainText(/your basket moved to/i);

  // 9. Top the basket up at the new shop. The move may legitimately have
  //    emptied it — the two shops stock different things, which is the whole
  //    reason a rebuild names what it dropped.
  await page.goto('/');
  await page.locator('article a[href^="/p/"]').first().click();
  const secondAddForm = page.locator('form').filter({ hasText: 'Add to basket' });
  await secondAddForm.getByRole('button', { name: 'Add to basket' }).click();
  await expect(secondAddForm.getByRole('status')).toContainText(/in your basket/i);

  // 10. Only now, optionally, create an account.
  await page.goto('/account/sign-up');
  await page.getByLabel('Name').fill('Golden Shopper');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mobile number').fill(phone);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('status').first()).toContainText(/sign in below/i);

  // Sign-up deliberately does not sign anyone in, so this is a second step.
  // The header also offers "Sign in"; this is the one in the page body.
  await page.goto('/account/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account$/);

  // 11. …and the basket built with no account is still there, now theirs.
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible();
  await expect(page.getByText(/subtotal/i)).toBeVisible();
});

test('an out-of-zone visitor is turned away kindly, and shown no prices', async ({ page }) => {
  await page.goto('/unserviceable?reason=out-of-zone');

  await expect(page.getByRole('heading', { name: /not in your area yet/i })).toBeVisible();
  await expect(page.getByText('₹')).toHaveCount(0);
  await expect(page.locator('article')).toHaveCount(0);

  const form = page.locator('form').filter({ hasText: 'Let us know' });
  await form.getByLabel('Locality').fill(`Nowhere ${run}`);
  await form.getByRole('button', { name: 'Let us know' }).click();
  await expect(form.getByRole('status')).toContainText(/thank you/i);
});

test('the seeded demo shopper can sign in and has an address', async ({ page }) => {
  await page.goto('/account/sign-in');
  await page.getByLabel('Email').fill(SEED_CUSTOMER);
  await page.getByLabel('Password', { exact: true }).fill(SEED_CUSTOMER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.getByRole('link', { name: 'Your addresses' }).click();
  await expect(page.getByText('221, 9th Main')).toBeVisible();
  await expect(page.getByText('Default', { exact: true })).toBeVisible();
});

/**
 * The phone the whole storefront is designed for. A horizontal scrollbar on the
 * body is the one layout bug that makes a shop unusable, so every page is
 * checked rather than a representative one.
 */
test('no page scrolls sideways on a 390px phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await pickArea(page, 'Jayanagar 4th Block');

  const aisle = await page.locator('a[href^="/c/"]').first().getAttribute('href');
  const product = await page.locator('article a[href^="/p/"]').first().getAttribute('href');

  const paths = [
    '/',
    '/locality',
    '/unserviceable',
    '/search?q=rice',
    '/cart',
    '/account/sign-in',
    '/account/sign-up',
    aisle ?? '/',
    product ?? '/',
  ];

  for (const path of paths) {
    await page.goto(path);
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(overflows, `${path} scrolls horizontally at 390px`).toBe(false);
  }
});

/**
 * Every image must be able to shrink. One oversized product photo is enough to
 * push the whole page wider than the screen, and it will not be spotted until
 * somebody opens that one product on a phone.
 */
test('images are constrained to their container', async ({ page }) => {
  await pickArea(page, 'Jayanagar 4th Block');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.locator('article a[href^="/p/"]').first().click();

  const images = page.locator('main img');
  for (let index = 0; index < (await images.count()); index += 1) {
    const width = await images.nth(index).evaluate((img) => img.getBoundingClientRect().width);
    expect(width).toBeLessThanOrEqual(390);
  }
});
