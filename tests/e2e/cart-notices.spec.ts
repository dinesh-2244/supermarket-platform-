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

/** A second line, so a removal can leave something behind to report about. */
const COMPANION = 'Filter Coffee Powder';
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

async function addToBasket(page: Page, product: string): Promise<void> {
  await page.goto(`/search?q=${encodeURIComponent(product)}`);
  await page.locator('article a[href^="/p/"]').filter({ hasText: product }).first().click();
  await expect(page).toHaveURL(/\/p\//);
  const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
  await addForm.getByRole('button', { name: 'Add to basket' }).click();
  await expect(addForm.getByRole('status')).toContainText(/in your basket/i);
}

async function addFixtureToBasket(page: Page): Promise<void> {
  await pickArea(page, AREA);
  await addToBasket(page, FIXTURE);
}

test.describe.serial('R1 — the shopper is told what the revalidation found', () => {
  /**
   * R1 residual — the notice used to die with the row that asked for it.
   *
   * The remove button's form is *inside* the row it removes, so a notice
   * returned from that action is unmounted by the very revalidation that
   * produced it. A shopper who removed one line was never told that another
   * line's price had moved — and the price had already been consumed, so no
   * later page load would tell them either.
   */
  test('removing one line still reports a price move on a line being kept', async ({
    page,
    browser,
  }) => {
    const admin = await openBackOffice(browser);
    const original = await currentPrice(admin);
    const raised = original.sellingPricePaise + 5_000;

    try {
      // Two lines: the one whose price will move, and the one to be removed.
      await addFixtureToBasket(page);
      await addToBasket(page, COMPANION);

      await page.goto('/cart');
      const kept = page.locator('li').filter({ hasText: FIXTURE });
      const doomed = page.locator('li').filter({ hasText: COMPANION });
      await expect(kept).toBeVisible();
      await expect(doomed).toBeVisible();

      await setPrice(admin, { mrpPaise: raised + 10_000, sellingPricePaise: raised });

      // Remove the *other* line. Its form disappears with it, which is the whole
      // point — the notice has to survive somewhere that is not that row.
      await doomed.locator('form').filter({ hasText: 'Remove' }).getByRole('button').click();

      await expect(doomed).toHaveCount(0);
      await expect(page.getByRole('status').filter({ hasText: /changed from/i })).toContainText(
        FIXTURE,
      );
      await expect(kept.getByText(`₹${(raised / 100).toFixed(2)} each`)).toBeVisible();
    } finally {
      await restore(admin, original);
      await admin.context().close();
    }
  });

  test('a removal that empties the basket still says what it found', async ({ page, browser }) => {
    const admin = await openBackOffice(browser);
    const original = await currentPrice(admin);

    try {
      await addFixtureToBasket(page);
      await addToBasket(page, COMPANION);
      await page.goto('/cart');

      // The companion is delisted, then the shopper removes the other line
      // themselves. The basket ends empty, with the least on screen to explain
      // itself and the most that needs explaining.
      await setListed(admin, false);
      await page
        .locator('li')
        .filter({ hasText: COMPANION })
        .locator('form')
        .filter({ hasText: 'Remove' })
        .getByRole('button')
        .click();

      await expect(page.getByText(/your basket is empty/i)).toBeVisible();
      await expect(
        page.getByRole('status').filter({ hasText: /no longer sold at your shop/i }),
      ).toContainText(FIXTURE);
    } finally {
      await restore(admin, original);
      await admin.context().close();
    }
  });

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

      // Basket level, not the row's own form. Every mutation's notices go to the
      // same place, because the remove button's form does not survive its own
      // action and two homes for one kind of message is how one of them rots.
      const notice = page.getByRole('status').filter({ hasText: /changed from/i });
      await expect(notice).toContainText(FIXTURE);
      await expect(notice).toContainText(/uses the new price/i);

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
