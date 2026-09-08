import { expect, test, type Page } from '@playwright/test';

/**
 * P3 — the storefront, in a browser, against a production build and a real
 * database.
 *
 * The story is a shopper's, not a developer's: arrive knowing nothing, say
 * where you live, and get the shop that serves you. Everything here is done
 * **without an account**, because that is the requirement (arch §5, R2) and the
 * only way to prove it is to never sign in.
 */

/** The seeded S1 area, whatever id it was given. */
async function pickFirstArea(page: Page): Promise<string> {
  const row = page.locator('form', { has: page.getByRole('button', { name: 'Deliver here' }) });
  const name = await row.first().locator('span.font-medium').first().textContent();
  await row.first().getByRole('button', { name: 'Deliver here' }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
  return (name ?? '').trim();
}

/** Pick a named seeded area — S1 and S2 are served by different shops. */
async function pickArea(page: Page, areaName: string): Promise<void> {
  await page.goto('/locality');
  const row = page.locator('form').filter({ hasText: areaName });
  await row.getByRole('button', { name: 'Deliver here' }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
}

test.describe.serial('storefront', () => {
  test('a first-time visitor is asked where they live before seeing any prices', async ({
    page,
  }) => {
    await page.goto('/');

    // No default store: the picker is an interstitial, not a suggestion.
    await expect(page).toHaveURL(/\/locality$/);
    await expect(page.getByRole('heading', { name: /where should we deliver/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deliver here' }).first()).toBeVisible();
  });

  test('choosing an area binds the store that serves it', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    await expect(page.getByRole('heading', { name: /shopping at/i })).toBeVisible();
    // The header names the shop, so "at whose prices?" is answerable everywhere.
    await expect(page.getByRole('button', { name: /change delivery area/i })).toBeVisible();
  });

  test('the area survives navigation and can be changed again', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    await page.goto('/');
    await expect(page).not.toHaveURL(/\/locality$/);

    await page.getByRole('button', { name: /change delivery area/i }).click();
    await expect(page).toHaveURL(/\/locality$/);
    // Forgetting the area really forgets it.
    await page.goto('/');
    await expect(page).toHaveURL(/\/locality$/);
  });

  test('a pincode nobody serves still shows the areas we do serve', async ({ page }) => {
    await page.goto('/locality?pincode=999999');

    await expect(page.getByText(/we do not deliver to 999999 yet/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deliver here' }).first()).toBeVisible();
  });

  test('an out-of-zone visitor sees no catalogue, and can leave their pincode', async ({
    page,
  }) => {
    await page.goto('/unserviceable?reason=out-of-zone');

    await expect(page.getByRole('heading', { name: /not in your area yet/i })).toBeVisible();
    await expect(page.getByText(/just outside our delivery zones/i)).toBeVisible();
    // No prices anywhere on this page — there is no store to price against.
    await expect(page.getByText('₹')).toHaveCount(0);

    const form = page.locator('form').filter({ hasText: 'Let us know' });
    await form.getByLabel('Pincode').fill('999999');
    await form.getByRole('button', { name: 'Let us know' }).click();
    await expect(form.getByRole('status')).toContainText(/thank you/i);
  });

  test('an empty interest form is refused rather than recorded', async ({ page }) => {
    await page.goto('/unserviceable');

    const form = page.locator('form').filter({ hasText: 'Let us know' });
    await form.getByRole('button', { name: 'Let us know' }).click();
    await expect(form.getByRole('status')).toContainText(/tell us your pincode or locality/i);
  });

  // A made-up reason must not become a message we render back at the visitor.
  test('a crafted reason in the URL is not echoed onto the page', async ({ page }) => {
    await page.goto('/unserviceable?reason=%3Cscript%3Ealert(1)%3C%2Fscript%3E');

    await expect(page.getByText(/we do not deliver to your area yet/i)).toBeVisible();
    await expect(page.getByText('script')).toHaveCount(0);
  });

  test('the catalogue shows this store’s products, prices and availability', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    // The seed lists products for the store; the shop window is not empty.
    await expect(page.getByRole('heading', { name: /shopping at/i })).toBeVisible();
    await expect(page.getByText(/product\(s\)/i).first()).toBeVisible();
    const cards = page.locator('article');
    expect(await cards.count()).toBeGreaterThan(0);

    // Every card carries a price and a stock band — the two things a shopper
    // compares — and no raw stock count above the low threshold.
    await expect(cards.first().getByText('₹').first()).toBeVisible();
    await expect(
      cards
        .first()
        .getByText(/in stock|only \d+ left|out of stock/i)
        .first(),
    ).toBeVisible();
  });

  test('an aisle browses its whole subtree and links back', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    const aisle = page.locator('a[href^="/c/"]').first();
    await expect(aisle).toBeVisible();
    await aisle.click();

    await expect(page).toHaveURL(/\/c\//);
    await expect(page.getByText(/product\(s\) in this aisle/i)).toBeVisible();
    await page.getByRole('link', { name: 'All products' }).first().click();
    await expect(page).toHaveURL(/\/$|\/\?/);
  });

  test('a product page shows the store’s price and a breadcrumb', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    const first = page.locator('article a[href^="/p/"]').first();
    const name = (await first.textContent())?.trim() ?? '';
    await first.click();

    await expect(page).toHaveURL(/\/p\//);
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(page.getByText('₹').first()).toBeVisible();

    // An in-stock product offers a real add control; an empty shelf offers a
    // disabled one. Either way the decision is the server's, not the button's.
    const add = page.getByRole('button', { name: /add to basket|out of stock/i });
    await expect(add).toBeVisible();
  });

  test('an unknown product slug is a 404, not an empty page', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    const response = await page.goto('/p/no-such-product-anywhere');
    expect(response?.status()).toBe(404);
  });

  test('an unknown aisle is a 404', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    const response = await page.goto('/c/no-such-aisle');
    expect(response?.status()).toBe(404);
  });

  test('a nonsense page number lands on page one rather than erroring', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    for (const query of ['?page=-4', '?page=abc', '?page=999999']) {
      const response = await page.goto(`/${query}`);
      expect(response?.status(), query).toBe(200);
      await expect(page.getByRole('heading', { name: /shopping at/i })).toBeVisible();
    }
  });

  test('search finds this shop’s products and handles an empty query', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    // Take a real product name from the shop window, then search for it.
    const name = (
      (await page.locator('article a[href^="/p/"]').first().textContent()) ?? ''
    ).trim();
    const term = name.split(' ').slice(0, 2).join(' ');

    await page.getByRole('link', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search/);
    // An empty query prompts rather than dumping the catalogue.
    await expect(page.getByText(/type something above to search/i)).toBeVisible();

    await page.getByLabel(/what are you looking for/i).fill(term);
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText(/result\(s\) for/i)).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('a search that matches nothing says so', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);
    await page.goto('/search?q=zzzzqqqqxxxx');

    await expect(page.getByText(/nothing matched/i)).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0);
  });

  test('a hostile search query is text, not syntax', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    for (const query of ['\'; DROP TABLE "Product"; --', '%', '_', '<script>alert(1)</script>']) {
      const response = await page.goto(`/search?q=${encodeURIComponent(query)}`);
      expect(response?.status(), query).toBe(200);
      // The query is echoed back as *text* in the heading, never as markup.
      await expect(page.locator('script:has-text("alert")')).toHaveCount(0);
    }

    // The catalogue is still there, which is the point of the first query.
    await page.goto('/');
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('a shopper fills a basket without ever signing in', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);

    // Open the first in-stock product and add it.
    await page.locator('article a[href^="/p/"]').first().click();
    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    await addForm.getByLabel('Quantity').fill('2');
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

    // The header count follows the basket.
    await expect(page.getByLabel(/item\(s\) in your basket/i)).toHaveText('2');

    await page.getByRole('link', { name: /^Basket/ }).click();
    await expect(page).toHaveURL(/\/cart$/);
    await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible();
    await expect(page.getByText(/subtotal \(2 item\(s\)\)/i)).toBeVisible();

    // Checkout exists, is disabled, and says where it went.
    const checkout = page.getByRole('button', { name: 'Proceed to checkout' });
    await expect(checkout).toBeDisabled();
    await expect(page.getByText(/checkout arrives in phase 4/i)).toBeVisible();

    // At no point was there a sign-in.
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
  });

  test('quantities can be changed and lines removed', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);
    await page.locator('article a[href^="/p/"]').first().click();

    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

    await page.goto('/cart');
    const qtyForm = page.locator('form').filter({ hasText: 'Update' }).first();
    await qtyForm.getByLabel('Qty').fill('3');
    await qtyForm.getByRole('button', { name: 'Update' }).click();
    await expect(page.getByText(/subtotal \(3 item\(s\)\)/i)).toBeVisible();

    await page
      .locator('form')
      .filter({ hasText: 'Remove' })
      .first()
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.getByText(/your basket is empty/i)).toBeVisible();
  });

  test('a fractional quantity is refused, not truncated', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);
    await page.locator('article a[href^="/p/"]').first().click();

    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    // `type=number` with the default `step=1` makes the browser refuse to submit
    // a fractional value at all, so the input is turned into a plain text box
    // first. That is exactly what a crafted POST looks like to the server, and
    // the server's answer is the only one that counts.
    await addForm.getByLabel('Quantity').evaluate((input: HTMLInputElement) => {
      input.type = 'text';
      input.value = '2.5';
    });
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/whole number/i);
  });

  test('an empty basket offers a way back to shopping', async ({ page }) => {
    await page.goto('/locality');
    await pickFirstArea(page);
    await page.goto('/cart');

    await expect(page.getByText(/your basket is empty/i)).toBeVisible();
    await page.getByRole('link', { name: 'Start shopping' }).click();
    await expect(page).toHaveURL(/\/$|\/\?/);
  });

  test('moving to an area served by the other shop rebuilds the basket', async ({ page }) => {
    // "Jayanagar 4th Block" is served by S1; "Indiranagar 1st Stage" by S2.
    await pickArea(page, 'Jayanagar 4th Block');
    const firstStore = await page.getByRole('heading', { name: /shopping at/i }).textContent();

    await page.locator('article a[href^="/p/"]').first().click();
    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

    await pickArea(page, 'Indiranagar 1st Stage');
    const secondStore = await page.getByRole('heading', { name: /shopping at/i }).textContent();
    // Genuinely the other shop, or this test proves nothing.
    expect(secondStore).not.toBe(firstStore);

    await page.goto('/cart');
    const notice = page.getByRole('status').first();
    await expect(notice).toContainText(/your basket moved to/i);
    // The summary names what happened, rather than only counting it.
    await expect(notice).toContainText(/came with you|removed/i);
  });

  test('moving within the same shop leaves the basket alone', async ({ page }) => {
    // Both areas are served by S1.
    await pickArea(page, 'Jayanagar 4th Block');
    await page.locator('article a[href^="/p/"]').first().click();
    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    await addForm.getByLabel('Quantity').fill('2');
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

    await pickArea(page, 'Jayanagar 7th Block');

    await page.goto('/cart');
    // No move notice, and the basket is exactly as it was.
    await expect(page.getByText(/your basket moved to/i)).toHaveCount(0);
    await expect(page.getByText(/subtotal \(2 item\(s\)\)/i)).toBeVisible();
  });

  test('the storefront does not scroll sideways on a small phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/locality');
    await pickFirstArea(page);

    for (const path of ['/', '/locality', '/unserviceable', '/search?q=rice', '/cart']) {
      await page.goto(path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${path} scrolls horizontally at 390px`).toBe(false);
    }
  });
});
