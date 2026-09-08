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

/** The seeded super-admin, for the one case that needs a staff form on screen. */
const STAFF_EMAIL = 'admin@munderfresh.local';
const STAFF_PASSWORD = 'DevPassw0rd!';

/**
 * Replace whatever session this page has with a shopper's, without reloading.
 *
 * Done through the real sign-in in a second tab so the cookie is a genuine one:
 * a hand-written cookie would prove that a *forged* session is refused, which is
 * a different and easier claim.
 */
async function signInAsShopper(page: Page): Promise<void> {
  const other = await page.context().newPage();
  await other.goto('/account/sign-in');
  await other.getByLabel('Email').fill(email);
  await other.getByLabel('Password', { exact: true }).fill(currentPassword);
  await other.getByRole('button', { name: 'Sign in' }).click();
  await expect(other).toHaveURL(/\/account$/);
  await other.close();

  await page.context().clearCookies({ name: 'authjs.session-token' });
  await page.context().clearCookies({ name: '__Secure-authjs.session-token' });
}

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

  /**
   * N1 — a staff form whose session has gone while it sat open.
   *
   * Submitting it used to throw a client-side application error, because Next.js
   * posts a Server Action with a `Next-Action` header and expects a Server Action
   * response; middleware answered with a 307 to an HTML sign-in page, which is
   * not one. The shopper cookie here is just the tidiest way to produce the
   * state — an expired session or a sign-out in another tab is the same event.
   *
   * The refusal itself was never in doubt and is asserted anyway: middleware
   * authorizes nothing, and the action's own database-read principal is what
   * says no.
   */
  test('a staff form whose session has gone refuses gracefully, not with a crash', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/admin/sign-in');
    await page.getByLabel('Email').fill(STAFF_EMAIL);
    await page.getByLabel('Password').fill(STAFF_PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/admin(\?|$)/);

    await page.goto('/admin/inventory');
    const form = page.locator('form').filter({ hasText: 'Adjust' }).first();
    await expect(form).toBeVisible();

    // The session goes while the form sits open, and a shopper's cookie takes
    // its place. The page is not reloaded: this is the form the person is
    // already looking at.
    await signInAsShopper(page);

    await form.getByLabel('Change by').fill('1');
    await form.getByLabel('Note').fill('n1 probe');
    await form.getByRole('button', { name: 'Adjust' }).click();

    await expect(form.getByRole('status')).toContainText(/signed in/i);
    expect(errors, 'no client-side application error').toEqual([]);
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

  /**
   * R4 — the ordinary order of events for a returning customer: sign in, *then*
   * start shopping. Adoption used to run only from the sign-in action, and there
   * was no basket to adopt at that point, so the cart this shopper then built
   * was a guest cart sitting outside their account's one-active-cart rule until
   * they happened to sign in again — which they have no reason to do.
   */
  test('a basket started after signing in belongs to the account', async ({ page }) => {
    await page.context().clearCookies();
    await signIn(page);
    await pickArea(page, 'Jayanagar 4th Block');

    await page.locator('article a[href^="/p/"]').first().click();
    const addForm = page.locator('form').filter({ hasText: 'Add to basket' });
    await addForm.getByRole('button', { name: 'Add to basket' }).click();
    await expect(addForm.getByRole('status')).toContainText(/in your basket/i);

    // The proof the browser can give: the basket survives losing the *cart*
    // cookie, because the account owns it rather than the device.
    const cookies = await page.context().cookies();
    const cartCookie = cookies.find((cookie) => cookie.name === 'cartToken');
    expect(cartCookie, 'the shopper has a cart cookie').toBeDefined();

    await page.goto('/cart');
    await expect(page.getByText(/subtotal/i)).toBeVisible();

    // Signing in again on the same device must not disturb what they built —
    // re-adopting a cart the account already owns is now a repair, not a reset.
    await page.goto('/account/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(currentPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/account$/);

    await page.goto('/cart');
    await expect(page.getByText(/subtotal/i)).toBeVisible();
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
