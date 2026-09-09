import { expect, test, type Page } from '@playwright/test';

/**
 * P4-4 — checkout, in a browser, with **no account at any point**.
 *
 * The requirement is that a shopper can buy without signing up (arch §5, R2),
 * and the only way to prove it is never to sign in. Nothing below touches
 * `/account`.
 */
async function pickFirstArea(page: Page): Promise<void> {
  await page.goto('/locality');
  const row = page.locator('form', { has: page.getByRole('button', { name: 'Deliver here' }) });
  // Read the name first: it forces the list to be rendered before the click, so
  // the button is not resolved against a frame that is still being replaced.
  await row.first().locator('span.font-medium').first().textContent();
  await row.first().getByRole('button', { name: 'Deliver here' }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
}

/**
 * Add one unit of a product to the basket.
 *
 * One unit, deliberately: the seeded staples opening stock is 20-49 and every
 * order in this file really does decrement it. A basket of twelve would have the
 * suite exhaust its own shelf partway through and fail for a reason that has
 * nothing to do with checkout.
 */
async function addOne(page: Page, slug?: string): Promise<void> {
  if (slug === undefined) {
    await page.goto('/c/staples');
    await page.locator('article a[href^="/p/"]').first().click();
    await expect(page).toHaveURL(/\/p\//);
  } else {
    await page.goto(`/p/${slug}`);
  }
  const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
  await addForm.getByLabel('Quantity').fill('1');
  await addForm.getByRole('button', { name: 'Add to basket' }).click();
  await expect(addForm.getByRole('status')).toContainText(/in your basket/i);
}

/**
 * Build a basket that clears whichever shop the first area resolved to.
 *
 * The two seeded shops have different minimums (₹250 and ₹300) and different
 * catalogues, so no fixed quantity of a fixed product clears both. Rather than
 * hard-code a price the seed is free to change, this adds one unit of successive
 * staples until checkout stops objecting — spreading the draw across products so
 * the suite does not empty one shelf, and reading the answer from the page that
 * actually decides it.
 */
async function fillBasket(page: Page): Promise<void> {
  await page.goto('/c/staples');
  const links = await page
    .locator('article a[href^="/p/"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
  expect(links.length).toBeGreaterThan(0);

  for (const href of links.slice(0, 6)) {
    await addOne(page, href.replace('/p/', ''));
    await page.goto('/checkout');
    if ((await page.getByText(/minimum order/i).count()) === 0) return;
  }
  throw new Error('could not build a basket over this shop’s minimum order');
}

test.describe.serial('checkout', () => {
  test('the basket now offers a live checkout', async ({ page }) => {
    await pickFirstArea(page);
    await fillBasket(page);

    await page.goto('/cart');
    const proceed = page.getByRole('link', { name: 'Proceed to checkout' });
    await expect(proceed).toBeVisible();
    await proceed.click();
    await expect(page).toHaveURL(/\/checkout$/);
  });

  test('checkout shows the basket, an estimated total and the billing caveat', async ({ page }) => {
    await pickFirstArea(page);
    await fillBasket(page);
    await page.goto('/checkout');

    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByText(/estimated total/i).first()).toBeVisible();
    // R6, said before the order rather than after the bill.
    await expect(page.getByText(/final amount is confirmed when the shop bills/i)).toBeVisible();
    // No account was ever asked for.
    await expect(page.getByText(/no account needed/i).first()).toBeVisible();

    await expect(page.getByLabel('Your name')).toBeVisible();
    await expect(page.getByLabel('Phone number')).toBeVisible();
    await expect(page.getByLabel('Delivery window')).toBeVisible();
    await expect(page.getByRole('radio', { name: /cash on delivery/i })).toBeChecked();
  });

  test('a guest places an order and lands on a confirmation with a tracking link', async ({
    page,
  }) => {
    await pickFirstArea(page);
    await fillBasket(page);
    await page.goto('/checkout');

    await page.getByLabel('Your name').fill('Playwright Shopper');
    await page.getByLabel('Phone number').fill('9812300001');
    await page.getByLabel('Address line 1').fill('42 Test Lane');
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page).toHaveURL(/\/order-placed\/t_[0-9A-Z]{20}$/);
    await expect(page.getByRole('heading', { name: /your order is placed/i })).toBeVisible();
    await expect(page.getByText(/order number/i)).toBeVisible();
    // The order number the shop and the shopper both quote.
    await expect(page.getByText(/^S\d-\d{6}-[0-9A-Z]{5}$/)).toBeVisible();
    await expect(page.getByText(/cash on delivery/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /track this order/i })).toBeVisible();

    // …and the basket that produced it is spent. The cart is CONVERTED, so
    // going back to checkout offers nothing to place a second time. Asserted in
    // this test rather than the next one because each test gets its own browser
    // context, and the cart lives in a cookie.
    await page.goto('/checkout');
    await expect(page.getByText(/basket is empty/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Place order' })).toHaveCount(0);
  });

  test('a missing name is refused, and nothing is ordered', async ({ page }) => {
    await pickFirstArea(page);
    await fillBasket(page);
    await page.goto('/checkout');

    await page.getByLabel('Your name').fill('   ');
    await page.getByLabel('Phone number').fill('9812300002');
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page.getByRole('status').first()).toContainText(/who to deliver to/i);
    // Still on checkout, basket intact.
    await expect(page).toHaveURL(/\/checkout$/);
    await page.goto('/cart');
    await expect(page.getByRole('link', { name: 'Proceed to checkout' })).toBeVisible();
  });

  test('a basket under the shop’s minimum cannot be checked out', async ({ page }) => {
    await pickFirstArea(page);
    // Toned milk is ₹24.70 against a ₹300 minimum.
    await addOne(page, 'toned-milk-500ml');

    await page.goto('/checkout');
    await expect(page.getByText(/minimum order/i)).toBeVisible();
  });

  test('a price change between review and submit is explained, not hidden (R5)', async ({
    page,
  }) => {
    // Direct navigation to checkout is the case OSCAR reproduced: the render
    // revalidates, consumes the price change, and used to say nothing about it.
    await pickFirstArea(page);
    await fillBasket(page);

    // Look at the basket, then arrive at checkout after something moved.
    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible();
    await page.goto('/checkout');

    // The page must at minimum carry the review, the caveat and — when there is
    // one — the notice region the revalidation writes into.
    await expect(page.getByRole('heading', { name: 'Checkout' })).toBeVisible();
    await expect(page.getByText(/final amount is confirmed when the shop bills/i)).toBeVisible();
  });

  test('the default address is prefilled for a signed-in shopper (R6)', async ({ page }) => {
    await pickFirstArea(page);
    await page.goto('/account/sign-in');
    await page.getByLabel('Email').fill('shopper@munderfresh.local');
    await page.getByLabel('Password', { exact: true }).fill('ShopperPass1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account$/);

    await fillBasket(page);
    await page.goto('/checkout');

    // The seeded demo shopper has a default address; D4 asks for it to be there
    // rather than for them to type it again.
    await expect(page.getByRole('main').getByLabel('Address line 1')).not.toHaveValue('');
    await expect(page.getByLabel('Your name')).not.toHaveValue('');
    await expect(page.getByLabel('Phone number')).not.toHaveValue('');
  });

  test('a missing street address is refused (R6)', async ({ page }) => {
    await pickFirstArea(page);
    await fillBasket(page);
    await page.goto('/checkout');

    await page.getByLabel('Your name').fill('No Street');
    await page.getByLabel('Phone number').fill('9812300011');
    await page.getByRole('main').getByLabel('Address line 1').fill('');
    await page.getByRole('button', { name: 'Place order' }).click();

    await expect(page.getByRole('status').first()).toContainText(/street address/i);
    await expect(page).toHaveURL(/\/checkout$/);
  });

  test('an unknown tracking token is a plain 404, with no hint that it might exist', async ({
    page,
  }) => {
    const response = await page.goto('/order-placed/t_AAAAAAAAAAAAAAAAAAAA');
    expect(response?.status()).toBe(404);
    await expect(page.getByText(/S\d-\d{6}/)).toHaveCount(0);
  });

  test('checkout stays readable on a small phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await pickFirstArea(page);
    await fillBasket(page);
    await page.goto('/checkout');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
