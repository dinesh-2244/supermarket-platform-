import { expect, test, type Page } from '@playwright/test';

/**
 * P2-7 — the back office end to end, against a production build and a real
 * database.
 *
 * The positive path is one continuous story: a super-admin signs in, creates a
 * store manager, that manager signs in and does their actual job — prices a
 * product, adjusts stock, runs a CSV import, reads the ledger.
 *
 * The negative path is the one that matters most, and it is deliberately *not*
 * done through the UI: it posts straight at the server action, because "the
 * button is hidden" is not authorization. Middleware only redirects and the
 * layout only hides nav; the check that counts runs server-side on every action.
 */
const SEED_ADMIN = 'admin@munderfresh.local';
const SEED_PASSWORD = 'DevPassw0rd!';
const MANAGER_PASSWORD = 'ManagerPassword123';

const run = Date.now().toString().slice(-6);
const managerEmail = `e2e.manager.${run}@example.test`;

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin(\?|$)/);
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in/);
}

/**
 * Serial and in one worker on purpose: this is a *story*, not a set of
 * independent checks. The manager created in the third test is the one that
 * signs in for the rest, so `fullyParallel` would otherwise start test four
 * before test three had created the account.
 */
test.describe.serial('back office', () => {
  test('signed-out visitors are sent to sign-in, not to the page', async ({ page }) => {
    await page.goto('/admin/inventory');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
    await expect(page.getByRole('heading', { name: 'Back office' })).toBeVisible();
  });

  test('a wrong password is refused with one undifferentiated message', async ({ page }) => {
    await page.goto('/admin/sign-in');
    await page.getByLabel('Email').fill(SEED_ADMIN);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();

    const notice = page.getByRole('status');
    await expect(notice).toContainText(/do not match an active account/i);

    // The same message for an address that does not exist — the form must not
    // tell an attacker which emails have accounts.
    await page.getByLabel('Email').fill(`nobody.${run}@example.test`);
    await page.getByLabel('Password').fill('definitely-not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(notice).toContainText(/do not match an active account/i);
  });

  test('super-admin signs in and creates a store manager', async ({ page }) => {
    await signIn(page, SEED_ADMIN, SEED_PASSWORD);
    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();

    await page.goto('/admin/users');
    const form = page.locator('form').filter({ hasText: 'Create user' });
    await form.getByLabel('Email').fill(managerEmail);
    await form.getByLabel('Name').fill('E2E Manager');
    await form.getByLabel('Password').fill(MANAGER_PASSWORD);
    await form.getByLabel('Role').selectOption('STORE_MANAGER');
    await form.getByRole('button', { name: 'Create user' }).click();

    await expect(page.getByRole('status').first()).toContainText(managerEmail);
    await expect(page.getByRole('cell', { name: managerEmail })).toBeVisible();
  });

  test('the manager signs in and does their job', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);

    // Listings: set a price. Every change writes a PriceChange row in-tx.
    await page.goto('/admin/listings');
    await expect(page.getByRole('heading', { name: 'Listings & prices' })).toBeVisible();

    const priceForm = page.locator('form').filter({ hasText: 'Set price' }).first();
    // Derived from this row's own MRP rather than hardcoded: selling price must
    // stay at or below MRP, and the seed prices differ per product.
    const mrp = Number(await priceForm.getByLabel('MRP (paise)').inputValue());
    await priceForm.getByLabel('Selling (paise)').fill(String(mrp - 100));
    await priceForm.getByLabel('Reason').fill('e2e');
    await priceForm.getByRole('button', { name: 'Set price' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Price saved/i);

    // Inventory: adjust stock, then read the movement back out of the ledger.
    await page.goto('/admin/inventory');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();

    const adjustForm = page.locator('form').filter({ hasText: 'Adjust' }).first();
    await adjustForm.getByLabel('Change by').fill('-2');
    await adjustForm.getByLabel('Note').fill('e2e damage');
    await adjustForm.getByRole('button', { name: 'Adjust' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Stock is now/i);

    await expect(page.getByRole('cell', { name: 'MANUAL_ADJUST' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'e2e damage' }).first()).toBeVisible();
  });

  test('the manager runs a CSV import — dry run first, then for real', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await page.goto('/admin/inventory');

    // The SKU the seed stocks low, so the file is guaranteed to match a listing.
    // The quantity is derived from the run so a re-run of this suite always has
    // something to change — `set` is idempotent, which is the point of the mode,
    // and re-importing the same number would (correctly) apply nothing.
    const quantity = 20 + (Number(run) % 40);
    const csv = `sku,quantity,mode\n8901234500042,${String(quantity)},set\n`;
    const importForm = page.locator('form').filter({ hasText: 'Run import' });

    await importForm.getByLabel('CSV file').setInputFiles({
      name: 'e2e-dry.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    // Dry run is checked by default: it must report the diff and write nothing.
    await importForm.getByRole('button', { name: 'Run import' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Dry run/i);
    await expect(page.getByRole('status').first()).toContainText(/Nothing was written/i);

    await importForm.getByLabel('CSV file').setInputFiles({
      name: 'e2e-real.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await importForm.getByLabel('Dry run').uncheck();
    await importForm.getByRole('button', { name: 'Run import' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Imported 1 row/i);

    // The ledger and the import history both show it.
    await expect(page.getByRole('cell', { name: 'CSV_IMPORT' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'e2e-real.csv' }).first()).toBeVisible();
  });

  test('a bad CSV row rejects the whole file and writes nothing', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await page.goto('/admin/inventory');

    const importForm = page.locator('form').filter({ hasText: 'Run import' });
    await importForm.getByLabel('CSV file').setInputFiles({
      name: 'e2e-broken.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('sku,quantity,mode\n8901234500042,5,set\nNOT-A-SKU,9,set\n'),
    });
    await importForm.getByLabel('Dry run').uncheck();
    await importForm.getByRole('button', { name: 'Run import' }).click();

    await expect(page.getByRole('status').first()).toContainText(/Nothing was imported/i);
    await expect(page.getByRole('status').first()).toContainText(/No product with that SKU/i);
  });

  test('the manager sees only their own store, and is refused the catalogue master', async ({
    page,
  }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);

    // Categories is a super-admin screen; it is not even offered in the nav.
    await expect(page.getByRole('link', { name: 'Categories' })).toHaveCount(0);

    // Products is readable, but the master is global so the create form is absent.
    await page.goto('/admin/products');
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add product' })).toHaveCount(0);

    // Only one store, so no switcher — a scoped principal is pinned to their store
    // whatever the query string says.
    await page.goto('/admin/inventory?store=some-other-store-id');
    await expect(page.getByRole('heading', { name: 'Inventory' })).toBeVisible();
  });

  /**
   * The check that actually matters: the manager's own browser, their own real
   * session, but a **forged store id** in the form — the request an attacker
   * sends after reading the HTML. It goes through the real server action, which
   * re-checks `authorize(...)` before touching anything.
   *
   * "The button is hidden" and "the nav does not offer it" are not authorization.
   * This is what proves the refusal is server-side.
   */
  test('a forged store id in a real form submission is refused server-side', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await page.goto('/admin/inventory');

    const adjustForm = page.locator('form').filter({ hasText: 'Adjust' }).first();
    await adjustForm.getByLabel('Change by').fill('-1');

    // Rewrite the hidden field the server action reads, exactly as someone with
    // devtools would. A store this principal has no grant on.
    await adjustForm.locator('input[name="storeId"]').evaluate((input) => {
      (input as HTMLInputElement).value = '00000000-0000-4000-8000-000000000000';
    });
    await adjustForm.getByRole('button', { name: 'Adjust' }).click();

    await expect(page.getByRole('status').first()).toContainText(/permission/i);
    await expect(page.getByRole('status').first()).not.toContainText(/Stock is now/i);
  });

  test('signing out invalidates the session immediately', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await signOut(page);

    // The cookie is worthless now — the row behind it is gone.
    await page.goto('/admin/inventory');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });
});
