import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { poolConfigFromUrl, prismaAdapterFromUrl, schemaFromUrl } from '../db/index';

/**
 * The URL-parameter translation the driver adapter made necessary.
 *
 * Prisma's query engine read `connection_limit` from the connection string;
 * `pg` has never heard of it. These assertions are the reason the Phase 4
 * concurrency tests still mean something — see `poolConfigFromUrl`.
 */
const BASE = 'postgresql://postgres:postgres@localhost:5432/supermarket';

/**
 * The startup `options` pg will actually send for a config — read off the real
 * client, not off our own object. `connectionParameters` is where pg keeps the
 * merged result; `@types/pg` does not declare it.
 */
function optionsSentBy(config: ReturnType<typeof poolConfigFromUrl>): string | undefined {
  const client = new pg.Client(config) as unknown as { connectionParameters: { options?: string } };
  return client.connectionParameters.options;
}

describe('poolConfigFromUrl', () => {
  it('turns connection_limit into the pool size', () => {
    expect(poolConfigFromUrl(`${BASE}?connection_limit=5`).max).toBe(5);
  });

  it('strips the parameters it consumed, so pg parses a plain URL', () => {
    const { connectionString } = poolConfigFromUrl(
      `${BASE}?connection_limit=5&pool_timeout=7&connect_timeout=3`,
    );
    expect(connectionString).not.toContain('connection_limit');
    expect(connectionString).not.toContain('pool_timeout');
    expect(connectionString).not.toContain('connect_timeout');
  });

  it('leaves every other parameter exactly as written', () => {
    const { connectionString } = poolConfigFromUrl(
      `${BASE}?sslmode=require&connection_limit=5&application_name=munder`,
    );
    expect(connectionString).toContain('sslmode=require');
    expect(connectionString).toContain('application_name=munder');
  });

  it('converts the timeouts from seconds to milliseconds', () => {
    expect(poolConfigFromUrl(`${BASE}?pool_timeout=7`).connectionTimeoutMillis).toBe(7_000);
    expect(poolConfigFromUrl(`${BASE}?connect_timeout=3`).connectionTimeoutMillis).toBe(3_000);
  });

  it('takes the larger when both timeouts are present', () => {
    // The only translation that cannot make a timeout stricter than it was,
    // which would turn a slow connection into a spurious failure.
    expect(
      poolConfigFromUrl(`${BASE}?pool_timeout=7&connect_timeout=3`).connectionTimeoutMillis,
    ).toBe(7_000);
    expect(
      poolConfigFromUrl(`${BASE}?pool_timeout=2&connect_timeout=9`).connectionTimeoutMillis,
    ).toBe(9_000);
  });

  it('passes "wait forever" through rather than turning it into a default', () => {
    // Prisma's pool_timeout=0 and pg's connectionTimeoutMillis: 0 agree here.
    expect(poolConfigFromUrl(`${BASE}?pool_timeout=0`).connectionTimeoutMillis).toBe(0);
    expect(poolConfigFromUrl(`${BASE}?connect_timeout=0`).connectionTimeoutMillis).toBe(0);
  });

  it('lets an explicit zero dominate a finite value on the other knob', () => {
    // `0` is Prisma's "no limit" sentinel, not the smallest number. Under the
    // max-of-two rule it must win, in either order: pg has one knob for both
    // waits, and the only translation that never tightens an explicit
    // "wait forever" is "wait forever".
    expect(
      poolConfigFromUrl(`${BASE}?pool_timeout=0&connect_timeout=1`).connectionTimeoutMillis,
    ).toBe(0);
    expect(
      poolConfigFromUrl(`${BASE}?connect_timeout=0&pool_timeout=1`).connectionTimeoutMillis,
    ).toBe(0);
    expect(
      poolConfigFromUrl(`${BASE}?pool_timeout=1&connect_timeout=0`).connectionTimeoutMillis,
    ).toBe(0);
    expect(
      poolConfigFromUrl(`${BASE}?pool_timeout=0&connect_timeout=0`).connectionTimeoutMillis,
    ).toBe(0);
  });

  it('omits what was not asked for, leaving pg on its own defaults', () => {
    const config = poolConfigFromUrl(BASE);
    expect(config.max).toBeUndefined();
    expect(config.connectionTimeoutMillis).toBeUndefined();
    expect(config.connectionString).toBe(BASE);
  });

  it('ignores values that are not usable numbers instead of guessing', () => {
    expect(poolConfigFromUrl(`${BASE}?connection_limit=lots`).max).toBeUndefined();
    expect(poolConfigFromUrl(`${BASE}?connection_limit=-1`).max).toBeUndefined();
  });

  it('hands a URL it cannot parse straight to pg, which reports it better', () => {
    expect(poolConfigFromUrl('not a url').connectionString).toBe('not a url');
  });
});

/**
 * `?schema=` is the one URL parameter the driver adapter takes *out of band*.
 *
 * Prisma's engine read it from the URL and both qualified every generated query
 * with it and set the connection's `search_path`. `pg` has never heard of it,
 * and `PrismaPg` only learns a schema from its second constructor argument — so
 * left in the URL it is dropped in silence and every client reads `public`
 * while the CLI, which still honours it, migrates the schema that was asked
 * for. Both halves have to travel: the adapter option for generated SQL, the
 * search path for the unqualified raw SQL in this module.
 */
describe('schema in the URL', () => {
  it('reads the schema out of the URL', () => {
    expect(schemaFromUrl(`${BASE}?schema=retail&connection_limit=5`)).toBe('retail');
    expect(schemaFromUrl(BASE)).toBeUndefined();
    expect(schemaFromUrl('not a url')).toBeUndefined();
  });

  it('strips schema from the string pg sees and sets the search path instead', () => {
    const config = poolConfigFromUrl(`${BASE}?schema=retail`);
    expect(config.connectionString).not.toContain('schema=');
    expect(config.options).toBe('-c search_path="retail"');
  });

  it('sets no search path when no schema was asked for', () => {
    expect(poolConfigFromUrl(BASE).options).toBeUndefined();
  });

  it('keeps an options= the URL already carried, and still appends the search path', () => {
    // Asked of the real pg client, because that is where the earlier version
    // lost: pg re-parses `connectionString` after merging the config object
    // and lets the URL's own `options=` win over a top-level one. So the URL
    // value has to be consumed here and folded into the one string pg gets,
    // search path last so it wins any accidental collision.
    const config = poolConfigFromUrl(`${BASE}?schema=retail&options=-c%20statement_timeout%3D5000`);
    expect(config.connectionString).not.toContain('options=');
    expect(optionsSentBy(config)).toBe('-c statement_timeout=5000 -c search_path="retail"');
  });

  it('leaves an options= alone when no schema joins it', () => {
    const config = poolConfigFromUrl(`${BASE}?options=-c%20statement_timeout%3D5000`);
    expect(optionsSentBy(config)).toBe('-c statement_timeout=5000');
  });

  it('refuses a schema it cannot pass through safely rather than dropping it', () => {
    // Anything that is not a plain identifier would need quoting rules this
    // translation does not have; the R2 lesson is that a schema silently lost
    // is worse than a loud refusal.
    expect(() => poolConfigFromUrl(`${BASE}?schema=retail%20shop`)).toThrow(/schema/);
    expect(() => poolConfigFromUrl(`${BASE}?schema=`)).toThrow(/schema/);
  });

  it('hands the schema to the adapter as its own option', async () => {
    // Asked of the real adapter: this is the value Prisma qualifies tables with.
    const withSchema = await prismaAdapterFromUrl(`${BASE}?schema=retail`).connect();
    const without = await prismaAdapterFromUrl(BASE).connect();
    try {
      expect(withSchema.getConnectionInfo?.().schemaName).toBe('retail');
      expect(without.getConnectionInfo?.().schemaName).toBeUndefined();
    } finally {
      await Promise.all([withSchema.dispose(), without.dispose()]);
    }
  });
});
