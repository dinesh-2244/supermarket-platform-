import { expect, test, type Page } from '@playwright/test';

/**
 * R5 — a delivery-area switch that cannot be served.
 *
 * The picker resolves serviceability on the server, which was never in doubt.
 * What was wrong is what happened to the context the shopper *already had*: the
 * action redirected to /unserviceable and left the old `storeContext` cookie
 * alone, so the redirect was cosmetic. The shopper could walk straight back into
 * the previous shop's basket and keep buying from a store they had just been
 * told does not serve them. D5 says the cart goes inert; it was not inert.
 *
 * The tampering is the honest form of the same event. An area can be
 * deactivated, or a store closed, between the picker rendering and the shopper
 * pressing the button — a stale form and a hand-edited one reach the server
 * identically, which is exactly why the server has to handle it.
 */
async function pickArea(page: Page, areaName: string): Promise<void> {
  await page.goto('/locality');
  await page
    .locator('form')
    .filter({ hasText: areaName })
    .getByRole('button', { name: 'Deliver here' })
    .click();
  await expect(page).toHaveURL(/\/$|\/\?/);
}

async function cookieValue(page: Page, name: string): Promise<string | undefined> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === name)?.value;
}

const storeContextCookie = (page: Page): Promise<string | undefined> =>
  cookieValue(page, 'storeContext');

const cartCookie = (page: Page): Promise<string | undefined> => cookieValue(page, 'cartToken');

/**
 * One test, not three.
 *
 * Playwright gives every test its own browser context, so a suite split across
 * three would start each one with no cookies — and "the basket is unreachable"
 * would pass for a visitor who never had a basket at all. The whole point is
 * what happens to a context and a cart that already exist, so the story has to
 * be continuous.
 */
test('an unserviceable switch takes the previous shop away, and gives the basket back', async ({
  page,
}) => {
  // A real shopper with a real shop and a real basket.
  await pickArea(page, 'Jayanagar 4th Block');
  await page.locator('article a[href^="/p/"]').first().click();
  const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
  await addForm.getByRole('button', { name: 'Add to basket' }).click();
  await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

  expect(await storeContextCookie(page), 'a context to lose').toBeDefined();
  const cartToken = await cartCookie(page);
  expect(cartToken, 'a basket to keep').toBeDefined();

  // Submit the picker for an area that does not resolve — the shape of a form
  // that has gone stale since it was rendered.
  await page.goto('/locality');
  const form = page.locator('form').filter({ hasText: 'Jayanagar 4th Block' });
  await form
    .locator('input[name="areaId"]')
    .evaluate((input: HTMLInputElement) => (input.value = 'no-such-area'));
  await form.getByRole('button', { name: 'Deliver here' }).click();

  await expect(page).toHaveURL(/\/unserviceable/);
  await expect(page.getByRole('heading', { name: /not in your area yet/i })).toBeVisible();
  // No prices, and no shop: the page must not be the old store's in disguise.
  await expect(page.getByText('₹')).toHaveCount(0);
  expect(await storeContextCookie(page)).toBeUndefined();

  // Inert, not usable. Without a context, the basket leads back to the picker,
  // and the homepage offers the community selector without any prices.
  await page.goto('/cart');
  await expect(page).toHaveURL(/\/locality$/);
  await page.goto('/');
  await expect(page.locator('article')).toHaveCount(0);

  // D5: losing the context is a cookie-level event, and nothing deleted the
  // cart. The same basket comes back when a real area is chosen again.
  expect(await cartCookie(page)).toBe(cartToken);
  await pickArea(page, 'Jayanagar 4th Block');
  await page.goto('/cart');
  await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible();
  await expect(page.getByText(/subtotal/i)).toBeVisible();
});
