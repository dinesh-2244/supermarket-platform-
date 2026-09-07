import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * The real launcher, not a unit test of `register()`.
 *
 * OSCAR's Phase 1 review caught that invalid configuration printed "Refusing to
 * start" and then… kept serving, answering 500s from `/api/health` with a zero
 * exit code no supervisor could alert on. Next.js catches whatever
 * `instrumentation.register()` throws, so the only way to prove the app now
 * fails closed is to launch it and watch it die.
 *
 * `.next/standalone/server.js` is the exact process `docker/Dockerfile`'s CMD
 * runs, and it exists here because the e2e suite already runs against a
 * production build.
 *
 * An *invalid* secret rather than a missing one: Next.js loads `.env` itself,
 * and `@next/env` leaves variables already present in `process.env` alone, so an
 * explicit too-short value is the only way to guarantee the child sees bad
 * config whether or not a developer has a `.env` on disk. Same Zod failure, same
 * code path.
 */
const STANDALONE = join(process.cwd(), '.next', 'standalone', 'server.js');

test('the production launcher exits non-zero on invalid configuration', async () => {
  test.setTimeout(90_000);
  expect(
    existsSync(STANDALONE),
    'run `npm run build` first — this spec launches the standalone server',
  ).toBe(true);

  const child = spawn('node', ['server.js'], {
    cwd: join(process.cwd(), '.next', 'standalone'),
    env: {
      ...process.env,
      APP_ENV: 'local',
      AUTH_SECRET: 'too-short',
      AUTH_URL: 'http://127.0.0.1:3987',
      // A port nothing else in the suite uses; the server must never reach it.
      PORT: '3987',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Server was still running after 60s:\n${output}`));
      }, 60_000);
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
    },
  );

  expect(output).toContain('Refusing to start');
  expect(output).toContain('AUTH_SECRET must be at least 32 characters');
  expect(exit.signal).toBeNull();
  expect(exit.code).toBe(1);
});
