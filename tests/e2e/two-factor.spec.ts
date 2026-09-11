import { expect, test, type Page } from '@playwright/test';
import { counterFor, totpCodeFor, TOTP_WINDOW_STEPS } from '../../src/modules/identity/domain/totp';

/**
 * P2 — optional two-factor authentication, end to end.
 *
 * The integration suite proves the policy against the service. This proves the
 * *wiring*, which is the part that cannot be checked any other way: that the
 * sign-in form's code field reaches the Credentials provider at all. A version
 * of this feature where enrolment works perfectly and the form quietly drops
 * the field would pass every unit and integration test in the repository, and
 * would leave every enrolled account signing in on the password alone.
 *
 * It runs against its own freshly created account. Enrolling the seeded admin
 * would leave the rest of the e2e suite unable to sign in if a single step here
 * failed part-way.
 */
const SEED_ADMIN = 'admin@munderfresh.local';
const SEED_PASSWORD = 'DevPassw0rd!';
const STAFF_PASSWORD = 'TwoFactorStaff123';

const run = Date.now().toString().slice(-6);
const staffEmail = `e2e.2fa.${run}@example.test`;

/** The secret shown during enrolment, carried between tests in this file. */
let secret = '';

/**
 * A code this account has not used yet.
 *
 * A code is accepted once: the server records the step it came from and
 * refuses that step and every earlier one afterwards. This whole story happens
 * inside one thirty-second step, so it cannot simply ask the clock four times —
 * it hands out consecutive steps instead, starting one step *behind* now (the
 * window accepts it, and it leaves more room ahead) and waiting for the clock
 * when the next step is further ahead than the window allows.
 */
let nextCounter: number | null = null;

async function freshCode(): Promise<string> {
  const behind = counterFor(Date.now()) - 1;
  nextCounter = nextCounter === null ? behind : Math.max(nextCounter, behind);
  while (nextCounter > counterFor(Date.now()) + TOTP_WINDOW_STEPS) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  const code = await totpCodeFor(secret, nextCounter);
  nextCounter += 1;
  return code;
}

async function signIn(page: Page, email: string, password: string, code = ''): Promise<void> {
  await page.goto('/admin/sign-in');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  if (code !== '') await page.getByLabel('Authenticator code').fill(code);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/sign-in/);
}

/**
 * Serial: this is one account's story — created, enrolled, signed in with a
 * code, then withdrawn. Each step depends on the previous one having happened.
 */
test.describe.serial('two-factor authentication', () => {
  // `freshCode` may wait for the next thirty-second step.
  test.describe.configure({ timeout: 90_000 });

  test('a super-admin creates the account that will enrol', async ({ page }) => {
    await signIn(page, SEED_ADMIN, SEED_PASSWORD);
    await expect(page).toHaveURL(/\/admin(\?|$)/);

    await page.goto('/admin/users');
    const form = page.locator('form').filter({ hasText: 'Create user' });
    await form.getByLabel('Email').fill(staffEmail);
    await form.getByLabel('Name').fill('E2E Two Factor');
    await form.getByLabel('Password').fill(STAFF_PASSWORD);
    await form.getByLabel('Role').selectOption('STORE_STAFF');
    const store = page.locator('select[name="storeId"] option', { hasText: /^S1 · / }).first();
    const storeId = await store.getAttribute('value');
    if (storeId === null) throw new Error('The seeded S1 store is not in the store list');
    await form.locator('select[name="storeId"]').selectOption(storeId);
    await form.getByRole('button', { name: 'Create user' }).click();

    await expect(page.getByRole('cell', { name: staffEmail })).toBeVisible();
  });

  test('the account signs in on its password alone and enrols', async ({ page }) => {
    await signIn(page, staffEmail, STAFF_PASSWORD);
    await expect(page).toHaveURL(/\/admin(\?|$)/);
    await expect(page.getByText('Off — your password alone signs you in.')).toBeVisible();

    await page.getByRole('link', { name: 'Set up two-factor authentication' }).click();
    await expect(page).toHaveURL(/\/admin\/two-factor/);

    secret = (await page.getByTestId('totp-secret').innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    const form = page.locator('form').filter({ hasText: 'Turn on' });
    await form.getByLabel('Current password').fill(STAFF_PASSWORD);
    await form.getByLabel('Code from your app').fill(await freshCode());
    await form.getByRole('button', { name: 'Turn on' }).click();

    await expect(page.getByRole('status').first()).toContainText('is on');
  });

  test('the password on its own no longer signs that account in', async ({ page }) => {
    await signIn(page, staffEmail, STAFF_PASSWORD);
    // Still on the sign-in page, with the same undifferentiated message a wrong
    // password gets — the form must not reveal who has a second factor.
    await expect(page).toHaveURL(/\/admin\/sign-in/);
    await expect(page.getByRole('status').first()).toContainText('do not match an active account');
  });

  test('the password plus a current code does', async ({ page }) => {
    await signIn(page, staffEmail, STAFF_PASSWORD, await freshCode());
    await expect(page).toHaveURL(/\/admin(\?|$)/);
    await expect(page.getByText('On — signing in asks for a code')).toBeVisible();
  });

  test('withdrawing it returns sign-in to the password alone', async ({ page }) => {
    await signIn(page, staffEmail, STAFF_PASSWORD, await freshCode());
    // Wait for the sign-in redirect to land: navigating straight to the page
    // races the server action, and the request arrives with no session.
    await expect(page).toHaveURL(/\/admin(\?|$)/);
    await page.goto('/admin/two-factor');

    const form = page.locator('form').filter({ hasText: 'Turn off' });
    await form.getByLabel('Current password').fill(STAFF_PASSWORD);
    await form.getByLabel('Code from your app').fill(await freshCode());
    await form.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByRole('status').first()).toContainText('is off');

    await signOut(page);
    await signIn(page, staffEmail, STAFF_PASSWORD);
    await expect(page).toHaveURL(/\/admin(\?|$)/);
  });
});
