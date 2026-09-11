import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/modules/platform';

/**
 * `p2-followup-gin-index-drift` — the drift that was hand-stripped seven times.
 *
 * The two `pg_trgm` GIN indexes were created by raw SQL in
 * 20260907200000_catalog_search_trgm and were invisible to the Prisma schema, so
 * `prisma migrate diff` proposed to DROP them in **every** migration generated
 * afterwards. Every one of those had to be edited by hand before it could be
 * applied, and a single missed edit would have silently removed catalogue search
 * — a change with no error, no failing test, and a symptom (slow search) that
 * only appears under a catalogue large enough to notice.
 *
 * They are declared in `schema.prisma` now, which fixes it at the source. This
 * file is what stops it coming back: a manual step that has been removed still
 * needs something to notice if it returns, and the schema is edited far more
 * often than anyone re-reads a migration comment.
 */
const prisma = getPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * What Prisma would write if asked to migrate this database to the schema.
 *
 * Run against the live, freshly-migrated database rather than a shadow replay:
 * the question is whether the schema describes *what is actually there*, and a
 * shadow database would only ever agree with the migrations that built it.
 */
function migrateDiff(): string {
  return execFileSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      // Prisma 7 removed `--from-url`. `--from-config-datasource` reads the
      // same URL from `prisma.config.ts`, which takes it from `DATABASE_URL` —
      // so this still diffs the live database the suite just migrated, which is
      // the whole point of the check. A shadow replay would only ever agree
      // with the migrations that built it.
      '--from-config-datasource',
      // `--to-schema-datamodel` was removed in the same release; `--to-schema`
      // is the replacement and takes the same path.
      '--to-schema',
      'prisma/schema.prisma',
      '--script',
    ],
    { encoding: 'utf8', env: process.env },
  );
}

describe('migration drift', () => {
  it('never proposes to drop the trigram search indexes', () => {
    const script = migrateDiff();

    // The specific regression, named so a failure says what broke rather than
    // just that something did.
    expect(script).not.toContain('Product_name_trgm_idx');
    expect(script).not.toContain('Product_brand_trgm_idx');
    expect(script.toUpperCase()).not.toContain('DROP INDEX');
  });

  it('has nothing at all to say about a freshly migrated database', () => {
    // Stronger than the case above and the real definition of "no drift": after
    // `migrate deploy`, the schema and the database agree completely. Any
    // difference — an index, a column, a default — is either an un-applied
    // migration or a schema change somebody forgot to generate one for.
    expect(migrateDiff()).toContain('This is an empty migration');
  });

  it('still has both trigram indexes, on the columns search actually uses', () => {
    // The diff being empty would also be satisfied by the indexes being absent
    // from *both* sides, so their existence is asserted separately.
    return prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND indexname LIKE '%trgm%'
      ORDER BY indexname
    `.then((rows) => {
      expect(rows.map((row) => row.indexname)).toEqual([
        'Product_brand_trgm_idx',
        'Product_name_trgm_idx',
      ]);
      for (const row of rows) {
        expect(row.indexdef).toContain('USING gin');
        expect(row.indexdef).toContain('gin_trgm_ops');
      }
    });
  });
});
