import { execFileSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selectForUpdate, type Tx } from '@/modules/platform';
import { newTestClient } from './prisma-client';

/**
 * `?schema=` in `DATABASE_URL` reaches every client, not only the CLI.
 *
 * Prisma's engine used to read the schema out of the URL. The driver adapter
 * does not: `pg` ignores the parameter, and `PrismaPg` only learns a schema
 * from its own constructor option. Left in the URL it was dropped in silence —
 * `migrate deploy` built the schema that was asked for, and the application
 * and the seed then read and wrote `public`.
 *
 * The witness is a database of this file's own, migrated and seeded through
 * the deployment's exact two commands with `?schema=retail`, and then read the
 * way the application reads. Its own database rather than a second schema in
 * the shared one, because `pg_trgm` is already installed in the shared
 * database's `public` and a custom schema's search path cannot see it — which
 * is a property of the migrations, not of the translation under test.
 */
const SCHEMA = 'retail';
const scratchDatabase = `supermarket_schema_${Math.random().toString(36).slice(2, 10)}`;

function urlFor(database: string, schema?: string): string {
  const url = new URL(process.env.DATABASE_URL ?? '');
  url.pathname = `/${database}`;
  url.searchParams.delete('schema');
  if (schema !== undefined) url.searchParams.set('schema', schema);
  return url.toString();
}

/** Issues CREATE/DROP DATABASE against the shared database; reads no rows. */
const admin = newTestClient();
/** Built the way the application builds its own — this is the client under test. */
const app = newTestClient(urlFor(scratchDatabase, SCHEMA));
/** Same database, no schema asked for: sees `public`, and can name `retail` explicitly. */
const plain = newTestClient(urlFor(scratchDatabase));

let owned = false;

function runAgainstScratch(step: string, args: string[]): void {
  try {
    execFileSync('npx', args, {
      stdio: 'pipe',
      env: { ...process.env, DATABASE_URL: urlFor(scratchDatabase, SCHEMA) },
    });
  } catch (error) {
    const detail = error as { stdout?: Buffer; stderr?: Buffer };
    throw new Error(
      `${step} failed against ${scratchDatabase}?schema=${SCHEMA}\n` +
        `${detail.stdout?.toString() ?? ''}\n${detail.stderr?.toString() ?? ''}`,
    );
  }
}

/** A one-row `count(*)` as a number; `count(*)` is `bigint` through the adapter. */
function only(rows: { count: bigint }[]): number {
  return Number(rows[0]?.count ?? -1);
}

async function seededStores(): Promise<number> {
  return only(
    await plain.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM "${SCHEMA}"."Store"`,
    ),
  );
}

beforeAll(async () => {
  await admin.$executeRawUnsafe(`CREATE DATABASE "${scratchDatabase}"`);
  owned = true;
  // The CLI honours `?schema=` on its own; these are the deployment's exact
  // steps, so `retail` below holds what a deployment's would.
  runAgainstScratch('prisma migrate deploy', ['prisma', 'migrate', 'deploy']);
  runAgainstScratch('seed', ['tsx', 'prisma/seed.ts']);
}, 120_000);

afterAll(async () => {
  await Promise.all([app.$disconnect(), plain.$disconnect()]);
  if (owned) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratchDatabase}"`);
  await admin.$disconnect();
});

describe('a custom schema in DATABASE_URL', () => {
  it('is where migrate and seed put the data, with public left empty', async () => {
    expect(await seededStores()).toBeGreaterThan(0);
    const publicTables = await plain.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM information_schema.tables WHERE table_schema = 'public'
    `;
    expect(only(publicTables)).toBe(0);
  });

  it('is what generated queries read through the application client', async () => {
    // Fails when the adapter is not told the schema: the client then asks for
    // `public."Store"`, which does not exist here.
    expect(await app.store.count()).toBe(await seededStores());
  });

  it('is what unqualified raw SQL reads through the application client', async () => {
    // Fails when the search path is not set: the adapter option qualifies
    // generated queries only, and this statement names no schema.
    const raw = await app.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count FROM "Store"`;
    expect(only(raw)).toBe(await seededStores());
  });

  it('is where the raw row lock finds its row', async () => {
    const [target] = await plain.$queryRawUnsafe<{ storeId: string; productId: string }[]>(
      `SELECT "storeId", "productId" FROM "${SCHEMA}"."InventoryItem" LIMIT 1`,
    );
    if (target === undefined) throw new Error('the seed left no InventoryItem to lock');
    // `selectForUpdate` says `FROM "InventoryItem"` with no schema. On the
    // wrong search path the statement has no such relation to lock.
    const locked = await app.$transaction((tx) =>
      selectForUpdate(tx as unknown as Tx, target.storeId, target.productId),
    );
    expect(locked?.storeId).toBe(target.storeId);
    expect(locked?.productId).toBe(target.productId);
  });
});
