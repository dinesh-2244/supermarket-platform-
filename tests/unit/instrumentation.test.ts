import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { register } from '@/instrumentation';
import { resetConfigForTests } from '@/modules/platform';

/**
 * Boot-time fail-closed behaviour (Definition of Done): a missing required
 * variable must stop startup with a readable message, not surface later as a
 * confusing runtime error.
 */
const original = { ...process.env };

beforeEach(() => {
  resetConfigForTests();
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

    await expect(register()).rejects.toThrow(/AUTH_SECRET/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Refusing to start'));
  });

  it('starts when the environment is complete', async () => {
    process.env.NEXT_RUNTIME = 'nodejs';
    process.env.APP_ENV = 'ci';
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/supermarket';
    process.env.AUTH_SECRET = 'a'.repeat(32);
    process.env.AUTH_URL = 'http://localhost:3000';

    await expect(register()).resolves.toBeUndefined();
  });

  it('does nothing on the edge runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge';
    delete process.env.AUTH_SECRET;

    await expect(register()).resolves.toBeUndefined();
  });
});
