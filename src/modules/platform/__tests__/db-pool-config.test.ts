import { describe, expect, it } from 'vitest';
import { poolConfigFromUrl } from '../db/index';

/**
 * The URL-parameter translation the driver adapter made necessary.
 *
 * Prisma's query engine read `connection_limit` from the connection string;
 * `pg` has never heard of it. These assertions are the reason the Phase 4
 * concurrency tests still mean something — see `poolConfigFromUrl`.
 */
const BASE = 'postgresql://postgres:postgres@localhost:5432/supermarket';

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
