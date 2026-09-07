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
/**
 * R11 — a **named, explicitly stocked** fixture rather than "whatever row sorts
 * first".
 *
 * The suite used to grab the first inventory form on the page, which is ordered
 * by product id. On a fresh seed that can be a zero-stock item, so subtracting 2
 * got the correct below-zero refusal and the test failed — a fixture defect that
 * looked like a product defect and skipped five following tests with it.
 */
const FIXTURE_SKU = '8901234500011';

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

/** The value of the seeded S1 store option, whatever id it was given. */
async function firstSeededStore(page: Page): Promise<string> {
  const option = page.locator('select[name="storeId"] option', { hasText: /^S1 · / }).first();
  const value = await option.getAttribute('value');
  if (value === null) throw new Error('The seeded S1 store is not in the store list');
  return value;
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
    // Pin the store rather than taking whichever option happens to be first:
    // the store list is ordered by code, and this suite creates stores of its
    // own, so "first" is not stable across runs.
    await form.locator('select[name="storeId"]').selectOption(await firstSeededStore(page));
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

    // Reconcile the named fixture to a known quantity first, so the adjustment
    // below is arithmetic on a value this test chose rather than on whatever the
    // seed happened to leave.
    const fixtureRow = page.locator('tr').filter({ hasText: FIXTURE_SKU }).first();
    const reconcile = fixtureRow.locator('form').filter({ hasText: 'Reconcile' });
    await reconcile.getByLabel('Counted').fill('40');
    await reconcile.getByRole('button', { name: 'Reconcile' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Reconciled|count matched/i);

    const adjustForm = page
      .locator('tr')
      .filter({ hasText: FIXTURE_SKU })
      .first()
      .locator('form')
      .filter({ hasText: 'Adjust' });
    await adjustForm.getByLabel('Change by').fill('-2');
    await adjustForm.getByLabel('Note').fill('e2e damage');
    await adjustForm.getByRole('button', { name: 'Adjust' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Stock is now 38/i);

    await expect(page.getByRole('cell', { name: 'MANUAL_ADJUST' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'e2e damage' }).first()).toBeVisible();
  });

  test('the manager runs a CSV import — dry run first, then for real', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await page.goto('/admin/inventory');

    // A named fixture SKU the seed always lists for this store.
    // The quantity is derived from the run so a re-run of this suite always has
    // something to change — `set` is idempotent, which is the point of the mode,
    // and re-importing the same number would (correctly) apply nothing.
    const quantity = 20 + (Number(run) % 40);
    const csv = `sku,quantity,mode\n${FIXTURE_SKU},${String(quantity)},set\n`;
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
      buffer: Buffer.from(`sku,quantity,mode\n${FIXTURE_SKU},5,set\nNOT-A-SKU,9,set\n`),
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

    const adjustForm = page
      .locator('tr')
      .filter({ hasText: FIXTURE_SKU })
      .first()
      .locator('form')
      .filter({ hasText: 'Adjust' });
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

  /**
   * R10 — the operations D7 requires must be reachable *through the UI*, not
   * merely present as a service underneath it.
   */
  test('a super-admin can create a store, a product, and give it its first price', async ({
    page,
  }) => {
    await signIn(page, SEED_ADMIN, SEED_PASSWORD);

    // A store, created from the UI rather than the seed.
    await page.goto('/admin/stores');
    const storeForm = page.locator('form').filter({ hasText: 'Create store' });
    await storeForm.getByLabel('Code', { exact: true }).fill(`E2E${run.slice(-3)}`);
    await storeForm.getByLabel('Name', { exact: true }).fill(`E2E Store ${run}`);
    await storeForm.getByLabel('City').fill('Bengaluru');
    await storeForm.getByRole('button', { name: 'Create store' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Created E2E/i);

    // A product in the shared master.
    await page.goto('/admin/products');
    const productForm = page.locator('form').filter({ hasText: 'Add product' });
    await productForm.getByLabel('SKU / barcode').fill(`E2E-SKU-${run}`);
    await productForm.getByLabel('Name').fill(`E2E Product ${run}`);
    await productForm.getByLabel('Pack size').fill('500 g');
    await productForm.getByRole('button', { name: 'Add product' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Added E2E Product/i);

    // …and its first price in a store, which previously had no UI path at all:
    // Listings only iterated StoreProducts that already existed.
    await page.goto('/admin/listings');
    const firstPrice = page.locator('form').filter({ hasText: 'Set first price' });
    await firstPrice
      .getByLabel('Product')
      .selectOption({ label: `E2E-SKU-${run} · E2E Product ${run}` });
    await firstPrice.getByLabel('MRP (paise)').fill('20000');
    await firstPrice.getByLabel('Selling (paise)').fill('18000');
    await firstPrice.getByRole('button', { name: 'Set first price' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Price saved/i);

    // It is now a listing, so it can be stocked.
    await expect(page.getByRole('cell', { name: `E2E-SKU-${run}` }).first()).toBeVisible();
  });

  test('a super-admin can edit a product and manage its images', async ({ page }) => {
    await signIn(page, SEED_ADMIN, SEED_PASSWORD);
    await page.goto(`/admin/products?q=${encodeURIComponent(`E2E Product ${run}`)}`);

    await page.getByRole('link', { name: 'edit' }).first().click();
    await expect(page.getByRole('heading', { name: /Edit E2E Product/ })).toBeVisible();

    // The fields that had no edit path before: name, brand, pack size, category.
    const edit = page.locator('form').filter({ hasText: 'Save product' });
    await edit.getByLabel('Brand').fill('E2E Brand');
    await edit.getByLabel('Pack size').fill('750 g');
    await edit.getByRole('button', { name: 'Save product' }).click();
    await expect(edit.getByRole('status')).toContainText(/saved/i);

    // Images: add two, reorder, remove one.
    //
    // Each ActionForm renders its own status message, so the assertions are
    // scoped to the form that produced them — `getByRole('status').first()`
    // picks whichever notice is first in the DOM, which is the edit form's.
    const addImage = page.locator('form').filter({ hasText: 'Add image' });
    await addImage.getByLabel('Image URL').fill('https://cdn.example/e2e-1.jpg');
    await addImage.getByRole('button', { name: 'Add image' }).click();
    await expect(addImage.getByRole('status')).toContainText(/Image added/i);

    await addImage.getByLabel('Image URL').fill('https://cdn.example/e2e-2.jpg');
    await addImage.getByRole('button', { name: 'Add image' }).click();
    await expect(page.getByRole('cell', { name: 'https://cdn.example/e2e-2.jpg' })).toBeVisible();

    // Reorder: image 2 was added second, so moving image 1 down puts it first.
    await expect(page.getByRole('cell', { name: 'https://cdn.example/e2e-1.jpg' })).toBeVisible();
    await page.getByRole('button', { name: 'Down' }).first().click();
    // A web-first assertion, which retries: `allTextContents()` reads the DOM
    // once, and the server action's revalidation had not landed yet in CI.
    await expect(page.getByRole('cell', { name: /cdn\.example/ }).first()).toHaveText(
      'https://cdn.example/e2e-2.jpg',
    );

    // Remove: assert the outcome, not a notice — the notice lives in the row's
    // own form, which disappears along with the row.
    await page.getByRole('button', { name: 'Remove' }).first().click();
    await expect(page.getByRole('cell', { name: 'https://cdn.example/e2e-2.jpg' })).toHaveCount(0);
    await expect(page.getByRole('cell', { name: 'https://cdn.example/e2e-1.jpg' })).toBeVisible();
  });

  test('a failed import can be diagnosed from its downloadable report and corrected', async ({
    page,
  }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await page.goto('/admin/inventory');

    // A file with one good row and one bad one: nothing is written.
    const importForm = page.locator('form').filter({ hasText: 'Run import' });
    await importForm.getByLabel('CSV file').setInputFiles({
      name: 'e2e-fixme.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`sku,quantity,mode\n${FIXTURE_SKU},33,set\nWRONG-SKU-${run},9,set\n`),
    });
    await importForm.getByLabel('Dry run').uncheck();
    await importForm.getByRole('button', { name: 'Run import' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Nothing was imported/i);

    // The report is downloadable and names the offending line.
    const link = page.getByRole('link', { name: 'download errors' }).first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    const report = await page.request.get(href!);
    expect(report.status()).toBe(200);
    expect(report.headers()['content-disposition']).toContain('attachment');
    const body = await report.text();
    expect(body.split('\n')[0]).toBe('line,sku,error');
    expect(body).toContain('No product with that SKU');

    // Corrected file — the good row now applies.
    await importForm.getByLabel('CSV file').setInputFiles({
      name: 'e2e-fixed.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`sku,quantity,mode\n${FIXTURE_SKU},33,set\n`),
    });
    await importForm.getByLabel('Dry run').uncheck();
    await importForm.getByRole('button', { name: 'Run import' }).click();
    await expect(page.getByRole('status').first()).toContainText(/Imported 1 row/i);
  });

  test('a dry run shows the per-row diff, not just a count', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await page.goto('/admin/inventory');

    const importForm = page.locator('form').filter({ hasText: 'Run import' });
    await importForm.getByLabel('CSV file').setInputFiles({
      name: 'e2e-preview.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`sku,quantity,mode\n${FIXTURE_SKU},77,set\n`),
    });
    await importForm.getByRole('button', { name: 'Run import' }).click();

    const notice = page.getByRole('status').first();
    await expect(notice).toContainText(/Dry run/i);
    // The actual diff: which SKU, from what, to what.
    await expect(notice).toContainText(FIXTURE_SKU);
    await expect(notice).toContainText('→ 77');
  });

  test('the ledger can be filtered by reason', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await page.goto('/admin/inventory');

    await page.locator('select[name="reason"]').selectOption('CSV_IMPORT');
    await page.getByRole('button', { name: 'Filter' }).click();

    // Wait for the filtered table before reading it — same reason as above.
    const reasonCells = page.getByRole('cell', {
      name: /^(MANUAL_ADJUST|CSV_IMPORT|RECONCILE)$/,
    });
    await expect(reasonCells.first()).toHaveText('CSV_IMPORT');

    const reasons = await reasonCells.allTextContents();
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((value) => value === 'CSV_IMPORT')).toBe(true);
  });

  /**
   * R8 — client-side validation is not validation. Both values are set through
   * the DOM, exactly as they would be with devtools open or from a script.
   */
  test('a fractional or suffixed quantity is refused, not truncated', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await page.goto('/admin/inventory');

    const row = page.locator('tr').filter({ hasText: FIXTURE_SKU }).first();
    const adjust = row.locator('form').filter({ hasText: 'Adjust' });
    const before = await row.locator('td').nth(2).textContent();

    // `1.9` used to become a stock movement of 1.
    await adjust.locator('input[name="delta"]').evaluate((input) => {
      const field = input as HTMLInputElement;
      field.type = 'text';
      field.value = '1.9';
    });
    await adjust.getByRole('button', { name: 'Adjust' }).click();
    await expect(page.getByRole('status').first()).toContainText(/whole number/i);
    await expect(page.getByRole('status').first()).not.toContainText(/Stock is now/i);

    // `10junk` used to become 10.
    await page.reload();
    const adjust2 = page
      .locator('tr')
      .filter({ hasText: FIXTURE_SKU })
      .first()
      .locator('form')
      .filter({ hasText: 'Adjust' });
    await adjust2.locator('input[name="delta"]').evaluate((input) => {
      const field = input as HTMLInputElement;
      field.type = 'text';
      field.value = '10junk';
    });
    await adjust2.getByRole('button', { name: 'Adjust' }).click();
    await expect(page.getByRole('status').first()).toContainText(/whole number/i);

    // The balance never moved.
    await page.reload();
    const after = await page
      .locator('tr')
      .filter({ hasText: FIXTURE_SKU })
      .first()
      .locator('td')
      .nth(2)
      .textContent();
    expect(after).toBe(before);
  });

  /**
   * R9 — the redirect after a genuine sign-in. The victim really does
   * authenticate on the real site first, which is what makes this convincing.
   */
  test('sign-in never redirects off-site, however next= is dressed up', async ({ page }) => {
    for (const attack of [
      'https://redirect-probe.invalid/landing',
      '//redirect-probe.invalid/landing',
      '/\\redirect-probe.invalid',
      '/api/health',
    ]) {
      await page.goto(`/admin/sign-in?next=${encodeURIComponent(attack)}`);
      await page.getByLabel('Email').fill(managerEmail);
      await page.getByLabel('Password').fill(MANAGER_PASSWORD);
      await page.getByRole('button', { name: 'Sign in' }).click();

      // Always somewhere under /admin on this origin.
      await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:\d+\/admin/);
      await signOut(page);
    }

    // …and a legitimate next= is still honoured.
    await page.goto('/admin/sign-in?next=%2Fadmin%2Finventory');
    await page.getByLabel('Email').fill(managerEmail);
    await page.getByLabel('Password').fill(MANAGER_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/inventory/);
  });

  test('signing out invalidates the session immediately', async ({ page }) => {
    await signIn(page, managerEmail, MANAGER_PASSWORD);
    await signOut(page);

    // The cookie is worthless now — the row behind it is gone.
    await page.goto('/admin/inventory');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });
});
