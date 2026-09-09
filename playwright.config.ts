import { defineConfig, devices } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.test', quiet: true });
loadDotenv({ path: '.env', quiet: true });

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

/**
 * E2E runs against a production build on a real database (§19). Phase 1 has a
 * single smoke spec; the golden-path suite arrives with the Phase 2 features.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  ...(process.env.CI ? { workers: 1 } : {}),
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Reuse an already-running server locally; always start a fresh one in CI.
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: `npx next start --port ${PORT}`,
          url: `${baseURL}/api/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          stdout: 'pipe',
          stderr: 'pipe',
          // **`AUTH_URL` must name the server this config just started.**
          //
          // Auth.js resolves `signOut({ redirectTo })` into an absolute URL
          // against `AUTH_URL`, so when `.env` carries the dev-server value
          // (`http://localhost:3000`) every sign-out in the suite navigates the
          // browser to port 3000 — where nothing is listening — and the page
          // lands on `chrome-error://chromewebdata/`. The CI workflow already
          // sets `AUTH_URL: http://127.0.0.1:3100` for exactly this reason,
          // which is why this only ever failed on a developer's machine.
          //
          // The harness owns the port, so the harness owns the matching
          // `AUTH_URL`. Deriving it from `baseURL` keeps the two in step even
          // when `E2E_PORT` is overridden.
          env: { AUTH_URL: baseURL },
        },
      }),
});
