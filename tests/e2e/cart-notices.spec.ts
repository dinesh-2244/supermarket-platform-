import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * R1 — the notices a basket mutation produces, seen by the shopper who caused
 * them.
 *
 * These cannot be proved by asserting on a service's return value, because the
 * defect was *between* the service and the screen: the service reported the
 * price move correctly and the action threw the report away, and by the time the
 * page revalidated a second time the snapshot had already been brought up to
 * date and there was nothing left to report. Only a browser sees that.
 *
 * Two browser contexts on purpose. The shop assistant changing a price is a
 * different person in a different session, and doing it in the shopper's own
 * context would replace the customer cookie with a staff one — which is a
 * different test entirely (N1).
 */
const SEED_ADMIN = 'admin@munderfresh.local';
const SEED_PASSWORD = 'DevPassw0rd!';

/** Listed and stocked at S2, unlisted at S1 — and used by no other spec. */
const FIXTURE = 'Green Tea Bags';
/** Indiranagar is S2's area. */
const AREA = 'Indiranagar 1st Stage';

async function pickArea(page: Page, areaName: string): Promise<void> {
  await page.goto('/locality');
  await page
    .locator('form')
    .filter({ hasText: areaName })
    .getByRole('button', { name: 'Deliver here' })
    .click();
  await expect(page).toHaveURL(/\/$|\/\?/);
}

/** A second, staff-side browser: the shop changing its own mind about a price. */
async function openBackOffice(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(SEED_ADMIN);
  await page.getByLabel('Password').fill(SEED_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);

  await selectFixtureStore(page);
  return page;
}

/**
 * Point the back office at the same shop the shopper is buying from.
 *
 * Navigated by the switcher's own href, so the store id stays out of this file —
 * it is a uuid the seed mints, and hardcoding one would tie the suite to the
 * database it was written against.
 *
 * The confirmation is the switcher's *selected* state, not the fixture's row.
 * The row is on both stores' pages (S1 carries the listing too, unlisted), so
 * asserting on it passes while the click's navigation is still in flight — which
 * is how this read S1's price for an S2 basket and reported a price that had not
 * moved.
 */
async function selectFixtureStore(admin: Page): Promise<void> {
  await admin.goto('/admin/listings');
  const link = admin.getByRole('link', { name: /^S2 · / });
  const href = await link.getAttribute('href');
  expect(href, 'the S2 switcher link').not.toBeNull();

  await admin.goto(href ?? '');
  await expect(admin.getByRole('link', { name: /^S2 · / })).toHaveClass(/bg-slate-900/);
  await expect(admin.getByRole('cell', { name: FIXTURE }).first()).toBeVisible();
}

/** The `<tr>` for the fixture product on the listings page. */
function listingRow(admin: Page): ReturnType<Page['locator']> {
  return admin.locator('tr').filter({ has: admin.getByRole('cell', { name: FIXTURE }) });
}

/**
 * Each assertion is scoped to its own form's notice.
 *
 * The page's first `role="status"` is whichever form was submitted last, so a
 * price change straight after a listing change reads the listing change's
 * message and the helper reports a failure that never happened.
 */
interface Price {
  readonly mrpPaise: number;
  readonly sellingPricePaise: number;
}

function priceForm(admin: Page): ReturnType<Page['locator']> {
  return listingRow(admin).locator('form').filter({ hasText: 'Set price' });
}

async function currentPrice(admin: Page): Promise<Price> {
  const form = priceForm(admin);
  return {
    mrpPaise: Number(await form.getByLabel('MRP (paise)').inputValue()),
    sellingPricePaise: Number(await form.getByLabel('Selling (paise)').inputValue()),
  };
}

/**
 * Both fields, in one submit.
 *
 * `setPrice` refuses a selling price above MRP, and the seed prices a listing at
 * a discount off its MRP — so raising the selling price alone is refused for a
 * reason that has nothing to do with what is being tested. Sending both together
 * also means a restore never passes through an invalid intermediate state.
 */
async function setPrice(admin: Page, price: Price): Promise<void> {
  const form = priceForm(admin);
  await form.getByLabel('MRP (paise)').fill(String(price.mrpPaise));
  await form.getByLabel('Selling (paise)').fill(String(price.sellingPricePaise));
  await form.getByRole('button', { name: 'Set price' }).click();
  await expect(form.getByRole('status')).toContainText(/Price saved/i);
}

async function setListed(admin: Page, listed: boolean): Promise<void> {
  const form = listingRow(admin).locator('form').filter({ hasText: 'Listed' });
  const box = form.getByLabel('Listed');
  if (listed) await box.check();
  else await box.uncheck();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('status')).toContainText(/saved|updated|listed/i);
}

/** Put the fixture back the way the seed left it, whatever the test did. */
async function restore(admin: Page, price: Price): Promise<void> {
  await selectFixtureStore(admin);
  await setListed(admin, true);
  await setPrice(admin, price);
}

async function addFixtureToBasket(page: Page): Promise<void> {
  await pickArea(page, AREA);
  await page.goto(`/search?q=${encodeURIComponent(FIXTURE)}`);
  await page.locator('article a[href^="/p/"]').filter({ hasText: FIXTURE }).first().click();
  await expect(page).toHaveURL(/\/p\//);
  const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
  await addForm.getByRole('button', { name: 'Add to basket' }).click();
  await expect(addForm.getByRole('status')).toContainText(/in your basket/i);
}

test.describe.serial('R1 — the shopper is told what the revalidation found', () => {
  test('a quantity change reports the price move it discovered', async ({ page, browser }) => {
    const admin = await openBackOffice(browser);
    const original = await currentPrice(admin);
    const raised = original.sellingPricePaise + 5_000;

    try {
      await addFixtureToBasket(page);

      // The basket is on screen, showing the old price, and then the shop
      // changes it. The order matters: loading /cart is itself a revalidation,
      // so a page opened *after* the change would consume the notice and this
      // would be testing nothing. A tab left open is the real case.
      await page.goto('/cart');
      const row = page.locator('li').filter({ hasText: FIXTURE });
      await expect(
        row.getByText(`₹${(original.sellingPricePaise / 100).toFixed(2)} each`),
      ).toBeVisible();

      // A price *rise* on purpose: being charged more without being told is the
      // half of this that actually costs the shopper something.
      await setPrice(admin, { mrpPaise: raised + 10_000, sellingPricePaise: raised });

      // The shopper knows nothing about any of that; they simply change the
      // quantity, on the page they were already looking at. This submission is
      // the *only* response that can tell them, because it is the one whose
      // revalidation consumed the difference — the re-render behind it finds an
      // already-updated snapshot and has nothing left to say.
      const qtyForm = row.locator('form').filter({ hasText: 'Update' });
      await qtyForm.getByLabel('Qty').fill('3');
      await qtyForm.getByRole('button', { name: 'Update' }).click();

      await expect(qtyForm.getByRole('status')).toContainText(/changed from/i);
      await expect(qtyForm.getByRole('status')).toContainText(/uses the new price/i);

      // …and the basket really is priced at the new price, not merely narrating.
      await page.goto('/cart');
      await expect(row.getByText(`₹${(raised / 100).toFixed(2)} each`)).toBeVisible();
    } finally {
      await restore(admin, original);
      await admin.context().close();
    }
  });

  test('a basket emptied by a delisting says what went, not just that it is empty', async ({
    page,
    browser,
  }) => {
    const admin = await openBackOffice(browser);
    const original = await currentPrice(admin);

    try {
      await addFixtureToBasket(page);
      await setListed(admin, false);

      await page.goto('/cart');
      // Both halves matter: the shop is honest that the basket is empty, and it
      // says where the thing the shopper chose actually went.
      await expect(page.getByText(/your basket is empty/i)).toBeVisible();
      await expect(
        page.getByRole('status').filter({ hasText: /no longer sold here/i }),
      ).toContainText(FIXTURE);
    } finally {
      await restore(admin, original);
      await admin.context().close();
    }
  });
});
