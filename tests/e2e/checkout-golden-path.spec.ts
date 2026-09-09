import { expect, test, type Page } from '@playwright/test';

/**
 * P4-8 — the Phase 4 golden path, as one continuous story.
 *
 * A shopper with no account browses, fills a basket, checks out, and is given an
 * order number and a link. Then the *shop* picks the order up: a manager finds
 * it in the queue, opens it, cancels it with a reason, and the stock comes back.
 * Finally the shopper's tracking link — which needed no account to begin with —
 * tells them the shop cancelled it.
 *
 * The other specs check the parts. This one exists because the joins are where
 * an order flow actually breaks: a token minted on one page and not readable on
 * another, a decrement that happens without its ledger row, a queue that shows
 * an order the manager cannot open.
 */
const MANAGER_PASSWORD = 'DevPassw0rd!';
const SEEDED_MANAGERS = ['manager.s1@munderfresh.local', 'manager.s2@munderfresh.local'];

async function pickFirstArea(page: Page): Promise<string> {
  await page.goto('/locality');
  const row = page.locator('form', { has: page.getByRole('button', { name: 'Deliver here' }) });
  const name = (await row.first().locator('span.font-medium').first().textContent()) ?? '';
  await row.first().getByRole('button', { name: 'Deliver here' }).click();
  await expect(page).toHaveURL(/\/$|\/\?/);
  return name.trim();
}

/** One unit of a product, by slug or the first in staples. */
async function addOne(page: Page, slug?: string): Promise<string> {
  if (slug === undefined) {
    await page.goto('/c/staples');
    await page.locator('article a[href^="/p/"]').first().click();
    await expect(page).toHaveURL(/\/p\//);
  } else {
    await page.goto(`/p/${slug}`);
  }
  const name = (await page.getByRole('heading', { level: 1 }).first().textContent()) ?? '';
  const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
  await addForm.getByLabel('Quantity').fill('1');
  await addForm.getByRole('button', { name: 'Add to basket' }).click();
  await expect(addForm.getByRole('status')).toContainText(/in your basket/i);
  return name.trim();
}

/** Add successive staples until checkout stops objecting about the minimum. */
async function basketOverMinimum(page: Page): Promise<void> {
  await page.goto('/c/staples');
  const hrefs = await page
    .locator('article a[href^="/p/"]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).getAttribute('href') ?? ''),
    );

  for (const href of hrefs.slice(0, 6)) {
    await addOne(page, href.replace('/p/', ''));
    await page.goto('/checkout');
    if ((await page.getByText(/minimum order/i).count()) === 0) return;
  }
  throw new Error('could not build a basket over this shop’s minimum order');
}

/**
 * Sign in as the manager of the shop that took this order.
 *
 * Which shop that is depends on which area the picker offered first, so it is
 * read from the order number's own prefix (`S1-…` / `S2-…`) rather than assumed.
 * Signing in as the *other* store's manager would fail here for the right
 * reason — the queue is store-scoped — but it would be testing that by accident.
 */
async function signInAsManagerFor(page: Page, orderNumber: string): Promise<void> {
  const storeCode = orderNumber.split('-')[0]?.toLowerCase() ?? '';
  const email = `manager.${storeCode}@munderfresh.local`;
  expect(SEEDED_MANAGERS).toContain(email);

  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(MANAGER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

test('a guest orders, the shop corrects it, and the stock comes back', async ({ page }) => {
  // 1. No account, ever. Pick an area and fill a basket.
  await pickFirstArea(page);
  await basketOverMinimum(page);

  // 2. Check out: contact, address, window, cash on delivery.
  await page.goto('/checkout');
  await expect(page.getByText(/final amount is confirmed when the shop bills/i)).toBeVisible();
  await page.getByLabel('Your name').fill('Golden Path');
  await page.getByLabel('Phone number').fill('9812399001');
  await page.getByLabel('Address line 1').fill('7 Golden Street');
  await page.getByRole('radio', { name: /cash on delivery/i }).check();
  await page.getByRole('button', { name: 'Place order' }).click();

  // 3. A confirmation with the number and the link.
  await expect(page).toHaveURL(/\/order-placed\/t_[0-9A-Z]{20}$/);
  const orderNumber = (
    await page
      .getByText(/^S\d-\d{6}-[0-9A-Z]{5}$/)
      .first()
      .textContent()
  )?.trim();
  expect(orderNumber).toBeTruthy();
  await page.getByRole('link', { name: /track this order/i }).click();
  // Wait for the navigation before reading the URL — `click()` resolves as soon
  // as the click is dispatched, not when the next document has loaded.
  await expect(page).toHaveURL(/\/order-status\/t_[0-9A-Z]{20}$/);
  const trackingUrl = page.url();
  await expect(page.getByRole('status')).toHaveText('Order placed');

  // 4. The link is the credential: it works with no cookies at all.
  await page.context().clearCookies();
  await page.goto(trackingUrl);
  await expect(page.getByRole('status')).toHaveText('Order placed');

  // 5. The shop picks it up. A manager finds it in their queue.
  await signInAsManagerFor(page, orderNumber!);
  await page.goto('/admin/orders');
  const queueLink = page.getByRole('link', { name: orderNumber! });
  await expect(queueLink).toBeVisible();
  await queueLink.click();
  await expect(page.getByRole('heading', { name: `Order ${orderNumber!}` })).toBeVisible();

  // 6. Cancel it, with the mandatory reason.
  await page.getByLabel('Reason').fill('Playwright golden path');
  await page.getByRole('button', { name: 'Cancel order' }).click();
  // The page itself now says it is cancelled and why, read from the order rather
  // than from a flash message — a manager who reloads still needs the answer.
  await expect(page.getByRole('status').first()).toContainText(/cancelled by the shop/i);
  await expect(page.getByRole('status').first()).toContainText(/Playwright golden path/);
  // …and how much stock came back, which is the point of the action (D6).
  await expect(page.getByText(/restored \d+ unit\(s\) to website stock/i)).toBeVisible();

  // 7. The shopper's link, still needing no account, now says so.
  await page.context().clearCookies();
  await page.goto(trackingUrl);
  await expect(page.getByRole('status')).toHaveText('Cancelled by the shop');
});

test('the whole Phase 4 flow fits a 390px phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await pickFirstArea(page);
  await basketOverMinimum(page);

  const overflows = async (): Promise<boolean> =>
    page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );

  for (const path of ['/cart', '/checkout']) {
    await page.goto(path);
    expect(await overflows(), `${path} scrolls sideways at 390px`).toBe(false);
  }

  await page.goto('/checkout');
  await page.getByLabel('Your name').fill('Small Screen');
  await page.getByLabel('Phone number').fill('9812399002');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page).toHaveURL(/\/order-placed\//);
  expect(await overflows(), '/order-placed scrolls sideways at 390px').toBe(false);

  await page.getByRole('link', { name: /track this order/i }).click();
  expect(await overflows(), '/order-status scrolls sideways at 390px').toBe(false);
});

test('the checkout form is reachable and labelled for a keyboard and a screen reader', async ({
  page,
}) => {
  await pickFirstArea(page);
  await basketOverMinimum(page);
  await page.goto('/checkout');

  // Every control the shopper must operate has an accessible name. Scoped to
  // `main`: the storefront header carries a "Change delivery area" button on
  // every page, which otherwise collides with the address picker's label.
  const form = page.getByRole('main');
  for (const label of ['Your name', 'Phone number', 'Delivery area', 'Delivery window']) {
    await expect(form.getByLabel(label)).toBeVisible();
  }
  await expect(page.getByRole('radio', { name: /cash on delivery/i })).toBeVisible();
  await expect(page.getByRole('radio', { name: /upi on delivery/i })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Place order' })).toBeVisible();

  // One h1, and it says where you are.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Checkout');
});
