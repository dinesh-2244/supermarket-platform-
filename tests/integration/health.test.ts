import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import {
  checkDbHealth,
  evaluateMigrationState,
  EXPECTED_MIGRATIONS,
  getPrisma,
  type MigrationAttempt,
  readMigrationAttempts,
  type Tx,
  withTransaction,
} from '@/modules/platform';

const prisma = getPrisma();

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Rolled back rather than committed: these cases deliberately corrupt the
 * migration history, and the next test in the run needs it intact.
 */
class Rollback extends Error {}

async function withMutatedHistory<T>(
  mutate: (tx: Tx) => Promise<void>,
  read: (attempts: readonly MigrationAttempt[]) => T,
): Promise<T> {
  let captured: { value: T } | undefined;

  try {
    await withTransaction(async (tx) => {
      await mutate(tx);
      captured = { value: read(await readMigrationAttempts(tx)) };
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }

  if (captured === undefined) throw new Error('the transaction body never ran');
  return captured.value;
}

describe('platform db health', () => {
  it('reports ok / current against a migrated database', async () => {
    await expect(checkDbHealth()).resolves.toEqual({ db: 'ok', migrations: 'current' });
  });

  // R5: each of these used to report `current`, because the old check only
  // counted rows whose finished_at was null.
  it('reports pending for an empty migration history', async () => {
    const state = await withMutatedHistory(
      async (tx) => {
        await tx.$executeRaw`DELETE FROM "_prisma_migrations"`;
      },
      (attempts) => ({ attempts: attempts.length, migrations: evaluateMigrationState(attempts) }),
    );

    expect(state).toEqual({ attempts: 0, migrations: 'pending' });
  });

  it('reports pending when an expected migration is missing from the history', async () => {
    const expected = EXPECTED_MIGRATIONS[0];
    expect(expected).toBeDefined();

    const migrations = await withMutatedHistory(
      async (tx) => {
        await tx.$executeRaw`DELETE FROM "_prisma_migrations" WHERE "migration_name" = ${expected}`;
      },
      (attempts) => evaluateMigrationState(attempts),
    );

    expect(migrations).toBe('pending');
  });

  it('reports pending while an attempt is recorded but unfinished', async () => {
    const migrations = await withMutatedHistory(
      async (tx) => {
        await tx.$executeRaw`UPDATE "_prisma_migrations" SET "finished_at" = NULL`;
      },
      (attempts) => evaluateMigrationState(attempts),
    );

    expect(migrations).toBe('pending');
  });

  it('reports current when a rolled-back migration was retried successfully', async () => {
    const expected = EXPECTED_MIGRATIONS[0];

    const migrations = await withMutatedHistory(
      async (tx) => {
        // `prisma migrate resolve --rolled-back` stamps the failed attempt…
        await tx.$executeRaw`
          UPDATE "_prisma_migrations"
          SET "finished_at" = NULL, "rolled_back_at" = NOW()
          WHERE "migration_name" = ${expected}
        `;
        // …and the retry inserts a fresh, successful row with the same name.
        await tx.$executeRaw`
          INSERT INTO "_prisma_migrations"
            ("id", "checksum", "migration_name", "started_at", "finished_at", "applied_steps_count")
          VALUES (gen_random_uuid()::text, 'retry', ${expected}, NOW(), NOW(), 1)
        `;
      },
      (attempts) => evaluateMigrationState(attempts),
    );

    expect(migrations).toBe('current');
  });

  it('reports db: down instead of throwing when the database is unreachable', async () => {
    // The real helper, pointed at a port nothing is listening on. The endpoint
    // has to degrade rather than crash — this exercises checkDbHealth itself,
    // not a bare PrismaClient call that happens to fail.
    const unreachable = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: 'postgresql://postgres:postgres@127.0.0.1:1/none',
        // Without this the adapter waits on `pg`'s default, and the test would
        // sit on a dead port until the suite timeout instead of asserting.
        connectionTimeoutMillis: 2_000,
      }),
    });

    try {
      await expect(checkDbHealth(unreachable)).resolves.toEqual({
        db: 'down',
        migrations: 'unknown',
      });
    } finally {
      await unreachable.$disconnect();
    }
  });
});
