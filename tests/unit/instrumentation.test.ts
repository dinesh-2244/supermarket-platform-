import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigForTests } from '@/modules/platform';

// `haltProcess` really does call `process.exit`, which would take the test
// runner down with it. Mocked here; `tests/integration/boot-fail-closed.test.ts`
// proves the un-mocked path by launching the real server.
const haltProcess = vi.hoisted(() =>
  vi.fn((code = 1) => {
    throw new Error(`process.exit(${code})`);
  }),
);
vi.mock('@/boot/fail-closed', () => ({ haltProcess }));

const { register } = await import('@/instrumentation');

/**
 * Boot-time fail-closed behaviour (Definition of Done): a missing required
 * variable must stop startup with a readable message, not surface later as a
 * confusing runtime error.
 */
const original = { ...process.env };

beforeEach(() => {
  resetConfigForTests();
  haltProcess.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  process.env = { ...original };
  resetConfigForTests();
  vi.restoreAllMocks();
});

describe('instrumentation.register', () => {
  it('refuses to start when a required variable is missing', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    delete process.env.AUTH_SECRET;

    // Fails *closed*: prints why, then exits non-zero. Next.js swallows a thrown
    // error and keeps listening, so a rethrow on its own was not enough.
    await expect(register()).rejects.toThrow(/process\.exit\(1\)/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Refusing to start'));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('AUTH_SECRET'));
    expect(haltProcess).toHaveBeenCalledWith(1);
  });

  it('starts when the environment is complete', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.APP_ENV = 'ci';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/supermarket';
    process.env.AUTH_SECRET = 'a'.repeat(32);
    process.env.AUTH_URL = 'http://localhost:3000';

    await expect(register()).resolves.toBeUndefined();
    expect(haltProcess).not.toHaveBeenCalled();
  });

  it('does nothing on the edge runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    delete process.env.AUTH_SECRET;

    await expect(register()).resolves.toBeUndefined();
  });
});
