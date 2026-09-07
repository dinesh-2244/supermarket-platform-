import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkDbHealth = vi.fn();

vi.mock('@/modules/platform', () => ({ checkDbHealth }));

const { GET } = await import('@/app/api/health/route');

/**
 * R5 follow-on: the endpoint's own contract, without a database.
 * `checkDbHealth` reporting `pending` has to become a 503 — a build served
 * against an un-migrated database is not ready, even though it answers.
 */
describe('GET /api/health', () => {
  beforeEach(() => {
    checkDbHealth.mockReset();
  });

  it('is 200 ok only when the db is up and migrations are current', async () => {
    checkDbHealth.mockResolvedValue({ db: 'ok', migrations: 'current' });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      db: 'ok',
      migrations: 'current',
    });
  });

  it('is 503 degraded when migrations are pending', async () => {
    checkDbHealth.mockResolvedValue({ db: 'ok', migrations: 'pending' });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: 'degraded',
      migrations: 'pending',
    });
  });

  it('is 503 degraded when the database is down', async () => {
    checkDbHealth.mockResolvedValue({ db: 'down', migrations: 'unknown' });

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: 'degraded', db: 'down' });
  });

  it('answers rather than throwing when the health check itself blows up', async () => {
    checkDbHealth.mockRejectedValue(new Error('datasource misconfigured'));

    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      status: 'degraded',
      db: 'down',
      migrations: 'unknown',
    });
  });
});
