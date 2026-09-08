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
          // The two projects run one after the other rather than interleaved.
          // Vitest 5 requires the order to be stated whenever projects differ in
          // worker count, and this is the order worth having anyway: the fast,
          // database-free project reports first, so a broken invariant is
          // visible before the slow half has finished.
          sequence: { groupOrder: 0 },
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
          // Vitest 4 removed `poolOptions` and lifted its contents to the top
          // level, so this is the same instruction spelled the current way.
          isolate: false,
          fileParallelism: false,
          sequence: { groupOrder: 1 },
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
      //
      // Re-based for @vitest/coverage-v8 v5, which counts differently. This is
      // the same coverage measured a new way, not a lowered bar — the tests did
      // not change, and the number of branch points they cover more than
      // doubled:
      //
      //              v3          v5
      //   covered    422   ->    967   (+545)
      //   total      485   ->   1268   (+783)
      //   pct     87.08%   -> 76.26%
      //
      // v3's provider reported `statements === lines` exactly (5001 for both)
      // and credited whole service files with 0 or 1 branch points —
      // catalog/service.ts 1 -> 97, stores/repo.ts 0 -> 38. That was a
      // degenerate count. v5 remaps against the AST and finds the branches that
      // were always there; 70% of the newly-counted ones were already covered.
      // The percentage fell because the denominator grew faster than the
      // numerator. Evidence: hive stabilization-report.md.
      //
      // So three of these four floors are now *higher* than the flat 80 they
      // replace. Only branches moves down, and only because its definition did.
      thresholds: {
        lines: 86,
        statements: 84,
        functions: 85,
        branches: 73,
      },
    },
  },
});
