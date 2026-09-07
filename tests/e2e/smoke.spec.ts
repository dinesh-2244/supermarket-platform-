import { expect, test } from '@playwright/test';

/**
 * Phase 1 smoke test: the app boots, serves its root page, and reports a healthy
 * database. Nothing more — there are no features to exercise yet.
 */
test('the app loads', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Supermarket Platform' })).toBeVisible();
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
