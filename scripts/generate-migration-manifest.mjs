#!/usr/bin/env node
/**
 * Regenerate `src/modules/platform/db/expected-migrations.ts` from
 * `prisma/migrations`.
 *
 * The health endpoint has to know which migrations *this build* expects, and it
 * cannot read the migrations directory at runtime: the Next standalone bundle
 * only traces JavaScript. Baking the identities into a checked-in module keeps
 * the list available everywhere the app runs, and
 * `expected-migrations.test.ts` fails if someone adds a migration and forgets
 * to re-run this.
 *
 *   npm run db:manifest
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const MIGRATIONS_DIR = 'prisma/migrations';
const OUT = 'src/modules/platform/db/expected-migrations.ts';

export function readMigrationDirectories(dir = MIGRATIONS_DIR) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export function renderManifest(names) {
  const entries = names.map((name) => `  '${name}',`).join('\n');
  return `// GENERATED FILE — do not edit by hand.
// Regenerate with \`npm run db:manifest\` after adding a Prisma migration.
//
// The migration identities this build ships with. \`checkDbHealth\` compares them
// against \`_prisma_migrations\` so a database that is empty, on an older schema,
// or mid-way through a failed migration reports \`pending\` instead of \`current\`.

export const EXPECTED_MIGRATIONS: readonly string[] = [
${entries}
];
`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const names = readMigrationDirectories();
  const next = renderManifest(names);
  const current = (() => {
    try {
      return readFileSync(OUT, 'utf8');
    } catch {
      return null;
    }
  })();
  if (current === next) {
    console.log(`${OUT} is already up to date (${names.length} migration(s)).`);
  } else {
    writeFileSync(OUT, next);
    console.log(`Wrote ${OUT} with ${names.length} migration(s): ${names.join(', ')}`);
  }
}
