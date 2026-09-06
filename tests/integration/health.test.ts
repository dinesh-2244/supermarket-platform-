import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { checkDbHealth } from '@/modules/platform';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('platform db health', () => {
  it('reports ok / current against a migrated database', async () => {
    await expect(checkDbHealth()).resolves.toEqual({ db: 'ok', migrations: 'current' });
  });

  it('reports db: down instead of throwing when the database is unreachable', async () => {
    // A port nothing is listening on: the check must degrade, not crash.
    const unreachable = new PrismaClient({
      datasources: { db: { url: 'postgresql://postgres:postgres@127.0.0.1:1/none' } },
    });

    let reported: 'ok' | 'down';
    try {
      await unreachable.$queryRaw`SELECT 1`;
      reported = 'ok';
    } catch {
      reported = 'down';
    } finally {
      await unreachable.$disconnect();
    }

    expect(reported).toBe('down');
  });
});
