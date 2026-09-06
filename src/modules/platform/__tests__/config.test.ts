import { describe, expect, it } from 'vitest';
import { ConfigError, type EnvSource, loadConfig } from '../config/index.js';

const VALID = {
  APP_ENV: 'ci',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/supermarket',
  AUTH_SECRET: 'a'.repeat(32),
  AUTH_URL: 'http://localhost:3000',
} satisfies EnvSource;

describe('platform/config', () => {
  it('accepts a complete environment and applies documented defaults', () => {
    const config = loadConfig(VALID);

    expect(config.APP_ENV).toBe('ci');
    expect(config.DEFAULT_CURRENCY).toBe('INR');
    expect(config.RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(config.RATE_LIMIT_MAX_REQUESTS).toBe(120);
    expect(config.LOG_LEVEL).toBe('info');
  });

  it.each(['DATABASE_URL', 'AUTH_SECRET', 'AUTH_URL', 'APP_ENV'] as const)(
    'fails closed when %s is missing',
    (key) => {
      const env: EnvSource = { ...VALID };
      delete env[key];

      expect(() => loadConfig(env)).toThrow(ConfigError);
      try {
        loadConfig(env);
      } catch (error) {
        expect((error as ConfigError).issues.join('\n')).toContain(key);
      }
    },
  );

  it('rejects a too-short AUTH_SECRET', () => {
    expect(() => loadConfig({ ...VALID, AUTH_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('rejects a non-Postgres DATABASE_URL', () => {
    expect(() => loadConfig({ ...VALID, DATABASE_URL: 'mysql://localhost/db' })).toThrow(
      ConfigError,
    );
  });

  it('rejects an unknown APP_ENV', () => {
    expect(() => loadConfig({ ...VALID, APP_ENV: 'prod' })).toThrow(ConfigError);
  });

  it('coerces numeric rate-limit values', () => {
    const config = loadConfig({ ...VALID, RATE_LIMIT_MAX_REQUESTS: '5' });
    expect(config.RATE_LIMIT_MAX_REQUESTS).toBe(5);
  });
});
