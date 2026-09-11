import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@/modules/platform';
import { newTestClient } from './prisma-client';

/**
 * `?connection_limit=N` really does cap the pool — measured against PostgreSQL,
 * not asserted against our own translation.
 *
 * The unit suite proves `poolConfigFromUrl` returns `max: 5`. That is only half
 * the claim: the other half is that `pg` honours it and the driver adapter uses
 * the pool we handed it. This counts actual backends in `pg_stat_activity`,
 * which is the only witness that cannot be satisfied by a plausible-looking
 * config object.
 *
 * It matters because Phase 4's concurrency work (ADR-0011) is run under
 * `connection_limit=5` deliberately: five is what a 2-vCPU CI runner gives, and
 * it is the constraint that caught the original blocking-advisory-lock design.
 * Silently getting `pg`'s default of 10 would leave those tests passing and
 * proving nothing.
 */
const observer = getPrisma();

const LIMIT = 2;
const CONCURRENT = 6;
const label = `pooltest_${Math.random().toString(36).slice(2, 10)}`;

afterAll(async () => {
  await observer.$disconnect();
});

describe('driver-adapter pool translation', () => {
  it(`opens at most ${String(LIMIT)} backends for ?connection_limit=${String(LIMIT)}`, async () => {
    const base = process.env.DATABASE_URL ?? '';
    const url = new URL(base);
    url.searchParams.set('connection_limit', String(LIMIT));
    // Tags this client's backends so the observer can count only ours.
    url.searchParams.set('application_name', label);

    const limited = newTestClient(url.toString());
    try {
      // More concurrent statements than the pool allows. If `max` were ignored
      // every one of them would get its own backend at once.
      // `::text` because `pg_sleep` returns `void`, which the adapter refuses
      // to deserialize — the sleep is the point, the value is not.
      const work = Array.from({ length: CONCURRENT }, () =>
        limited.$queryRawUnsafe('SELECT pg_sleep(0.35)::text AS slept'),
      );

      let peak = 0;
      const watching = (async () => {
        for (let i = 0; i < 12; i += 1) {
          const rows = await observer.$queryRaw<{ count: bigint }[]>`
            SELECT count(*) AS count FROM pg_stat_activity WHERE application_name = ${label}
          `;
          peak = Math.max(peak, Number(rows[0]?.count ?? 0));
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      })();

      await Promise.all([...work, watching]);

      // The assertion that fails if the translation is dropped: without it the
      // adapter would open CONCURRENT backends, not LIMIT.
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThanOrEqual(LIMIT);
    } finally {
      await limited.$disconnect();
    }
  }, 30_000);

  it('waits past a finite connect_timeout when pool_timeout=0 asks for "forever"', async () => {
    // `0` is Prisma's "no limit" sentinel. Combined with a finite
    // `connect_timeout` it used to lose the max-of-two comparison and cut the
    // pool wait short. The witness is pg's own queue: with one connection held,
    // a second statement must still be queued after the finite value has
    // elapsed, and must then succeed when the holder lets go.
    const url = new URL(process.env.DATABASE_URL ?? '');
    url.searchParams.set('connection_limit', '1');
    url.searchParams.set('pool_timeout', '0');
    url.searchParams.set('connect_timeout', '1');

    const single = newTestClient(url.toString());
    try {
      await single.$queryRawUnsafe('SELECT 1'); // warm, so both statements below queue on one pool
      const started = Date.now();
      // A PrismaPromise is lazy: it runs only once something calls `.then` on
      // it. Merely constructing the holder would leave the connection free
      // and the second statement through in ~100ms, proving nothing.
      const holder = Promise.resolve(single.$queryRawUnsafe('SELECT pg_sleep(1.6)::text AS slept'));
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The assertion that fails if a finite value overrides the zero: pg
      // rejects this after ~1s with "timeout exceeded when trying to connect".
      await expect(single.$queryRawUnsafe('SELECT 2 AS two')).resolves.toBeDefined();
      expect(Date.now() - started).toBeGreaterThan(1_000);
      await holder;
    } finally {
      await single.$disconnect();
    }
  }, 30_000);
});
