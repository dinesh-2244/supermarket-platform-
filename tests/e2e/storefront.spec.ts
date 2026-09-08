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

  test('the storefront does not scroll sideways on a small phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/locality');
    await pickFirstArea(page);

    for (const path of ['/', '/locality', '/unserviceable']) {
      await page.goto(path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(overflows, `${path} scrolls horizontally at 390px`).toBe(false);
    }
  });
});
