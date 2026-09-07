import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const srcAlias = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '@': srcAlias },
  },
  test: {
    projects: [
      {
        resolve: { alias: { '@': srcAlias } },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/__tests__/**/*.test.ts', 'tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias: { '@': srcAlias } },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['tests/integration/setup.ts'],
          // Integration tests share one database; run them in a single worker.
          poolOptions: { forks: { singleFork: true } },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/modules/**/*.ts'],
      exclude: [
        // Public barrels only — `src/modules/<name>/index.ts` re-exports and
        // nothing else. The kernel's implementations are *also* called index.ts
        // (platform/money/index.ts, platform/db/index.ts, …), so the recursive
        // `src/modules/**/index.ts` this used to be silently removed every line
        // of executable platform code from the denominator and left the gate
        // measuring empty module skeletons.
        'src/modules/*/index.ts',
        'src/modules/**/__tests__/**',
        // Generated from prisma/migrations; asserted on by expected-migrations.test.ts.
        'src/modules/platform/db/expected-migrations.ts',
      ],
      // Gate is wired now and ratchets up as Phase 2 fills the modules in (§19).
      // These are floors under the *real* numbers, not the numbers themselves.
      thresholds: {
        lines: 65,
        statements: 65,
        functions: 75,
        branches: 85,
      },
    },
  },
});
