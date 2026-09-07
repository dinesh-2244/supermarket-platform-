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
      // Floors under the real numbers, not the numbers themselves.
      //
      // The gate measures the **whole** suite, unit and integration together
      // (`npm run test:coverage` runs both projects), which is why it needs a
      // database. Measuring only the unit project would systematically
      // under-report: most of what Phase 2 added is service and repository code
      // whose correctness is exactly what the integration tests establish —
      // ledger atomicity, cross-store denial, import rollback. A gate that
      // could not see any of that would be back to measuring skeletons.
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 80,
      },
    },
  },
});
