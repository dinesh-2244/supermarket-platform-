import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * `.env` has to be loaded here, by hand.
 *
 * The moment this file exists the CLI announces "Prisma config detected,
 * skipping environment variable loading" and stops reading `.env` itself — so
 * without this every `migrate`/`generate`/`db seed` fails with "Environment
 * variable not found: DATABASE_URL" on a developer machine. CI passes
 * `DATABASE_URL` in the environment and would not have caught it, which is
 * exactly the sort of break that reaches people one at a time.
 *
 * `.env.test` first so a test run's database wins where both define it, matching
 * the order `playwright.config.ts` already uses.
 */
loadDotenv({ path: '.env.test', quiet: true });
loadDotenv({ path: '.env', quiet: true });

/**
 * Prisma CLI configuration.
 *
 * The seed command used to live in `package.json#prisma`, which Prisma 6
 * deprecates and Prisma 7 removes — it printed a warning on every `generate`,
 * `migrate` and `db seed`, including in CI, which is how a real warning ends up
 * being ignored. Moving it here silences that honestly rather than by filtering
 * the output, and it is the file Prisma 7 will want regardless (see the
 * stabilization report for why that upgrade is deferred).
 *
 * Deliberately minimal: only the two things the CLI cannot infer. The datasource
 * URL stays in `prisma/schema.prisma` for now, because moving it here is part of
 * the Prisma 7 driver-adapter change and not of this one.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
