import { expect, test, type Page } from '@playwright/test';

/**
 * P3-6 — optional customer accounts, in a browser.
 *
 * The two things worth proving here cannot be seen from a unit test: that
 * shopping never *requires* an account, and that a shopper's session is
 * worthless in the back office. Both are exercised as a person would.
 */
const run = Date.now().toString().slice(-6);
const email = `e2e.shopper.${run}@example.test`;
const phone = `98${run.padStart(8, '0')}`;
const PASSWORD = 'ShopperPassw0rd';
const ROTATED_PASSWORD = 'AnotherPassw0rd';

/**
 * The suite is serial and one test deliberately changes the password, so
 * "the password" is a moving target after that point. Tracked here rather than
 * reordering the tests: the change-password case belongs where it reads best,
 * and every later sign-in should use whatever the account's password now is.
 */
let currentPassword = PASSWORD;

async function pickArea(page: Page, areaName: string): Promise<void> {
  await page.goto('/locality');
  await page
    .locator('form')
    .filter({ hasText: areaName })
    .getByRole('button', { name: 'Deliver here' })
    .click();
  await expect(page).toHaveURL(/\/$|\/\?/);
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/account/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(currentPassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/account$/);
}

test.describe.serial('customer accounts', () => {
  test('signing up does not sign you in — and says the same thing either way', async ({ page }) => {
    await page.goto('/account/sign-up');

    await page.getByLabel('Name').fill('E2E Shopper');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mobile number').fill(phone);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    const notice = page.getByRole('status').first();
    await expect(notice).toContainText(/sign in below/i);
    // Still anonymous: the account area is not open.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/account\/sign-in$/);

    // The same submission for an address that now exists gives the same words.
    await page.goto('/account/sign-up');
    await page.getByLabel('Name').fill('Impostor');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Mobile number').fill(`97${run.padStart(8, '0')}`);
    await page.getByLabel(/^Password/).fill(PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('status').first()).toContainText(/sign in below/i);
  });

  test('a wrong password is refused in the same words as an unknown address', async ({ page }) => {
    await page.goto('/account/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('NotThePassword1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    const wrongPassword = await page.getByRole('status').first().textContent();

    await page.goto('/account/sign-in');
    await page.getByLabel('Email').fill(`nobody.${run}@example.test`);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    const unknownEmail = await page.getByRole('status').first().textContent();

    // One answer, so the form cannot be used to find out who has an account.
    expect(wrongPassword).toBe(unknownEmail);
  });

  test('a guest basket comes with the shopper when they sign in', async ({ page }) => {
    await pickArea(page, 'Jayanagar 4th Block');
    await page.locator('article a[href^="/p/"]').first().click();
    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    await addForm.getByLabel('Quantity').fill('2');
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

    await signIn(page);

    // The basket survived the sign-in, items and all.
    await page.goto('/cart');
    await expect(page.getByText(/subtotal \(2 item\(s\)\)/i)).toBeVisible();
  });

  test('a signed-in shopper can edit their details', async ({ page }) => {
    await signIn(page);

    const details = page.locator('form').filter({ hasText: 'Save' });
    await details.getByLabel('Name').fill('Renamed Shopper');
    await details.getByRole('button', { name: 'Save' }).click();
    await expect(details.getByRole('status')).toContainText(/saved/i);

    await page.reload();
    await expect(page.locator('form').filter({ hasText: 'Save' }).getByLabel('Name')).toHaveValue(
      'Renamed Shopper',
    );
  });

  /** The isolation ADR-0010 exists for, seen from the browser. */
  test('a customer session opens nothing in the back office', async ({ page }) => {
    await signIn(page);

    // Middleware bounces it to the *staff* sign-in, not into the admin.
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
    await page.goto('/admin/inventory');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });

  test('signing out invalidates the session immediately', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: 'Sign out' }).click();
    // Sign-out lands on the storefront root, which sends a visitor with no
    // chosen area on to the picker — so assert we left the account area rather
    // than pinning an exact destination.
    await expect(page).not.toHaveURL(/\/account/);

    // The cookie is worthless: going back does not restore the session.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/account\/sign-in$/);
  });

  test('changing a password signs every device out', async ({ page }) => {
    await signIn(page);

    const form = page.locator('form').filter({ hasText: 'Change password' });
    await form.getByLabel('Current password').fill(currentPassword);
    await form.getByLabel(/^New password/).fill(ROTATED_PASSWORD);
    await form.getByRole('button', { name: 'Change password' }).click();

    await expect(page).toHaveURL(/\/account\/sign-in\?changed=1/);
    await expect(page.getByText(/every device has been signed out/i)).toBeVisible();

    // The old password no longer works; the new one does.
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('status').first()).toContainText(/do not match/i);

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(ROTATED_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account$/);

    currentPassword = ROTATED_PASSWORD;
  });

  test('a shopper can keep an address book', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Your addresses' }).click();
    await expect(page).toHaveURL(/\/account\/addresses$/);

    const addForm = page.locator('form').filter({ hasText: 'Save address' });
    await addForm.getByLabel('Label (Home, Work…)').fill('Home');
    await addForm.getByLabel('Address line').fill('12 Test Street');
    await addForm.getByLabel('Delivery area').selectOption({ index: 1 });
    await addForm.getByLabel('Pincode (optional)').fill('560011');
    await addForm.getByRole('button', { name: 'Save address' }).click();
    await expect(addForm.getByRole('status')).toContainText(/saved/i);

    // The first address is the default whether or not it was asked for.
    // Scoped to the saved-addresses card: the add form's own label mentions
    // "Home" too, and `getByText` is strict about that.
    const saved = page.locator('section').filter({ hasText: 'saved address' });
    await expect(saved.getByText('Home', { exact: false }).first()).toBeVisible();
    await expect(saved.getByText('Default', { exact: true })).toHaveCount(1);

    // A second one, made the default, moves the badge rather than duplicating it.
    await addForm.getByLabel('Label (Home, Work…)').fill('Work');
    await addForm.getByLabel('Address line').fill('99 Office Road');
    await addForm.getByRole('checkbox').check();
    await addForm.getByRole('button', { name: 'Save address' }).click();
    await expect(addForm.getByRole('status')).toContainText(/saved/i);
    await expect(saved.getByText('Default', { exact: true })).toHaveCount(1);

    // Removing one leaves the book usable.
    await page
      .locator('form')
      .filter({ hasText: 'Remove' })
      .first()
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.getByText(/1 saved address/i)).toBeVisible();
  });

  test('order history is an honest empty state, not a missing page', async ({ page }) => {
    await signIn(page);
    await page.getByRole('link', { name: 'Your orders' }).click();

    await expect(page).toHaveURL(/\/account\/orders$/);
    await expect(page.getByText(/no orders yet/i)).toBeVisible();
    await expect(page.getByText(/ordering arrives in the next release/i)).toBeVisible();
  });

  test('the account area is closed to anyone without a session', async ({ page }) => {
    await page.context().clearCookies();
    for (const path of ['/account', '/account/addresses', '/account/orders']) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/account\/sign-in$/);
    }
  });

  test('browsing and carting never ask for an account', async ({ page }) => {
    await page.context().clearCookies();
    await pickArea(page, 'Jayanagar 4th Block');

    await page.locator('article a[href^="/p/"]').first().click();
    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

    await page.goto('/cart');
    await expect(page.getByRole('heading', { name: 'Your basket' })).toBeVisible();
    // The header offers a sign-in, it does not demand one.
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });
});
