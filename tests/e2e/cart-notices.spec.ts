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
 * The option's *value* is a store id nothing in this file may hardcode, so it is
 * read off the option whose label the seed guarantees.
 */
async function selectFixtureStore(admin: Page): Promise<void> {
  await admin.goto('/admin/listings');
  const option = admin.locator('select[name="store"] option', { hasText: /^S2 · / }).first();
  const value = await option.getAttribute('value');
  await admin.locator('select[name="store"]').selectOption(value ?? '');
  await expect(admin.getByRole('cell', { name: FIXTURE }).first()).toBeVisible();
}

/** The `<tr>` for the fixture product on the listings page. */
function listingRow(admin: Page): ReturnType<Page['locator']> {
  return admin.locator('tr').filter({ has: admin.getByRole('cell', { name: FIXTURE }) });
}

async function setSellingPrice(admin: Page, paise: number): Promise<void> {
  const form = listingRow(admin).locator('form').filter({ hasText: 'Set price' });
  await form.getByLabel('Selling (paise)').fill(String(paise));
  await form.getByRole('button', { name: 'Set price' }).click();
  await expect(admin.getByRole('status').first()).toContainText(/Price saved/i);
}

async function setListed(admin: Page, listed: boolean): Promise<void> {
  const form = listingRow(admin).locator('form').filter({ hasText: 'Listed' });
  const box = form.getByLabel('Listed');
  if (listed) await box.check();
  else await box.uncheck();
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(admin.getByRole('status').first()).toContainText(/saved|updated|listed/i);
}

/** Put the fixture back the way the seed left it, whatever the test did. */
async function restore(admin: Page, sellingPaise: number): Promise<void> {
  await selectFixtureStore(admin);
  await setListed(admin, true);
  await setSellingPrice(admin, sellingPaise);
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
    const original = Number(
      await listingRow(admin)
        .locator('form')
        .filter({ hasText: 'Set price' })
        .getByLabel('Selling (paise)')
        .inputValue(),
    );

    try {
      await addFixtureToBasket(page);
      await setSellingPrice(admin, original + 5_000);

      // The shopper knows nothing about any of that; they simply change the
      // quantity. This submission is the *only* response that can tell them,
      // because it is the one whose revalidation consumed the difference.
      await page.goto('/cart');
      const row = page.locator('li').filter({ hasText: FIXTURE });
      const qtyForm = row.locator('form').filter({ hasText: 'Update' });
      await qtyForm.getByLabel('Qty').fill('3');
      await qtyForm.getByRole('button', { name: 'Update' }).click();

      await expect(qtyForm.getByRole('status')).toContainText(/changed from/i);
      await expect(qtyForm.getByRole('status')).toContainText(/uses the new price/i);

      // …and the basket really is priced at the new price, not merely narrating.
      await page.goto('/cart');
      await expect(row.getByText(`₹${((original + 5_000) / 100).toFixed(2)} each`)).toBeVisible();
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
    const original = Number(
      await listingRow(admin)
        .locator('form')
        .filter({ hasText: 'Set price' })
        .getByLabel('Selling (paise)')
        .inputValue(),
    );

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
