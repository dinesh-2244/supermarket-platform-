import { NextResponse } from 'next/server';
import { checkDbHealth } from '@/modules/platform';

/** Never cached — a health probe must reflect the current process. */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface HealthBody {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  migrations: 'current' | 'pending' | 'unknown';
}

/**
 * Liveness + readiness probe (Deliverable 7).
 *
 * A database that is down or behind on migrations is *reported*, not thrown:
 * the endpoint answers 503 with a readable body so an operator can tell the
 * difference between "the app is dead" and "the app is up, the database is not".
 */
export async function GET(): Promise<NextResponse<HealthBody>> {
  let health: Awaited<ReturnType<typeof checkDbHealth>>;
  try {
    health = await checkDbHealth();
  } catch {
    // A misconfigured or unreachable datasource must still produce a response.
    health = { db: 'down', migrations: 'unknown' };
  }

  const status: HealthBody['status'] =
    health.db === 'ok' && health.migrations === 'current' ? 'ok' : 'degraded';

  return NextResponse.json(
    { status, db: health.db, migrations: health.migrations },
    {
      status: status === 'ok' ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
