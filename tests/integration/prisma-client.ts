import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { poolConfigFromUrl } from '../../src/modules/platform/db/index';

/**
 * A *second* connection, built exactly the way the application builds its own.
 *
 * Several tests here need a connection the code under test is not using — a
 * holder that takes an advisory lock and keeps it, an observer that reads a row
 * another transaction has locked `FOR UPDATE`. Under Prisma 6 a bare
 * `new PrismaClient()` was that, and it read `connection_limit` from the URL by
 * itself.
 *
 * Under the driver adapter a bare client has no connection at all, and one
 * built by hand would quietly get `pg`'s default pool of 10 rather than the
 * `?connection_limit=5` those very tests exist to run under. Routing them
 * through the same `poolConfigFromUrl` the app uses is what keeps "a second
 * connection like the app's" true rather than approximately true.
 */
export function newTestClient(url: string = process.env.DATABASE_URL ?? ''): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg(poolConfigFromUrl(url)) });
}
