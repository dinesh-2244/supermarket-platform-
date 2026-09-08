import { expect, test } from '@playwright/test';

/**
 * Smoke test: the app boots, serves its root, and reports a healthy database.
 *
 * The root is the **storefront** from Phase 3 on, and a visitor with no store
 * context is sent to the locality picker — so "it loads" now means "it asks me
 * where I live", not the Phase 1 placeholder page that used to live at `/`.
 */
test('the app loads', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: /where should we deliver/i })).toBeVisible();
});

test('the health endpoint reports a migrated database', async ({ request }) => {
  const response = await request.get('/api/health');

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: 'ok',
    db: 'ok',
    migrations: 'current',
  });
});
