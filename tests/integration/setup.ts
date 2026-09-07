import { execFileSync } from 'node:child_process';
import { config as loadDotenv } from 'dotenv';

// Integration tests need a real PostgreSQL (docker/docker-compose.yml provides
// one locally; CI uses a `postgres:16` service container).
loadDotenv({ path: '.env.test', quiet: true });
loadDotenv({ path: '.env', quiet: true });

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is required for integration tests. Start the dev database with ' +
      '`docker compose -f docker/docker-compose.yml up -d postgres` and copy .env.example to .env.',
  );
}

// Bring the schema up to date before any test runs. `migrate deploy` is
// idempotent, so repeated runs against a warm database are cheap.
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  stdio: 'inherit',
  env: process.env,
});
