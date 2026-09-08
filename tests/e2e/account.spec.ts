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
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
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
    await expect(page).toHaveURL(/\/$|\/\?/);

    // The cookie is worthless: going back does not restore the session.
    await page.goto('/account');
    await expect(page).toHaveURL(/\/account\/sign-in$/);
  });

  test('changing a password signs every device out', async ({ page }) => {
    await signIn(page);

    const form = page.locator('form').filter({ hasText: 'Change password' });
    await form.getByLabel('Current password').fill(PASSWORD);
    await form.getByLabel(/^New password/).fill('AnotherPassw0rd');
    await form.getByRole('button', { name: 'Change password' }).click();

    await expect(page).toHaveURL(/\/account\/sign-in\?changed=1/);
    await expect(page.getByText(/every device has been signed out/i)).toBeVisible();

    // The old password no longer works; the new one does.
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('status').first()).toContainText(/do not match/i);

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill('AnotherPassw0rd');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account$/);
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
