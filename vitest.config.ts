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
      // Re-based for @vitest/coverage-v8 v5. The tests did not change; the
      // *counting method* did. v5 makes AST-aware remapping the default. The
      // proof is that v3 reproduces v5's numbers exactly once you ask it for
      // the same method:
      //
      //   A  v3 default   npm run test:coverage
      //   B  v3 + remap   npm run test:coverage -- \
      //                     --coverage.experimentalAstAwareRemapping
      //   C  v5 default   npm run test:coverage
      //
      //   (A on main@88b1798 / vitest 3.2.4; B likewise; C on this branch.
      //    Add --coverage.reporter=json-summary and read total in
      //    coverage-summary.json.)
      //
      //                   A v3 default    B v3 + remap    C v5 default
      //   lines           4552/5001 91.02  1501/1674 89.66  1499/1674 89.54
      //   statements      4552/5001 91.02  1627/1857 87.61  1617/1857 87.07
      //   functions        372/412  90.29   469/530  88.49   469/530  88.49
      //   branches        1232/1416 87.00   967/1268 76.26   967/1268 76.26
      //
      // B and C agree on branches and functions to the unit in every one of the
      // 48 per-file summaries — zero mismatches — so the branch drop
      // 87.00 -> 76.26 is A-vs-B, a remapping difference, not coverage the
      // suite stopped reaching. (Lines and statements differ between B and C in
      // 1 and 4 files, by 2 and 10 covered on identical denominators: ordinary
      // run-to-run variance.)
      //
      // A is the odd column out, and gives itself away: it reports
      // `statements === lines` exactly (4552/5001 for both), which no
      // source-based counter does. B and C, remapping to the AST, separate them
      // (1857 statements over 1674 lines).
      //
      // Each floor below sits under the observed C column with 3.0-3.6pp of
      // headroom, and three of the four are *higher* than the flat 80 they
      // replace. Only branches moves down, and only because its definition did.
      // Full evidence and logs: hive stabilization-report.md.
      thresholds: {
        lines: 86,
        statements: 84,
        functions: 85,
        branches: 73,
      },
    },
  },
});
