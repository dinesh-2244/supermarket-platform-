import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from '../expected-migrations';

/**
 * `expected-migrations.ts` is generated (`npm run db:manifest`) because the Next
 * standalone bundle traces JavaScript only — it does not carry
 * `prisma/migrations` into the app runtime. This test is the thing that stops it
 * going stale: add a migration without regenerating and the health endpoint
 * would go on reporting `current` for a database that is behind.
 */
describe('expected migrations manifest', () => {
  it('matches prisma/migrations exactly', () => {
    const onDisk = readdirSync('prisma/migrations', { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect([...EXPECTED_MIGRATIONS].sort()).toEqual(onDisk);
  });
});
