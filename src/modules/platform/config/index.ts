import { z } from 'zod';

/**
 * Environment contract (architecture §22). Env carries *infrastructure and
 * secrets only* — per-store business settings live in the `StoreSettings` table.
 */
const envSchema = z.object({
  APP_ENV: z.enum(['local', 'ci', 'staging', 'production']),
  DATABASE_URL: z.string().url().startsWith('postgres', {
    message: 'DATABASE_URL must be a PostgreSQL connection string',
  }),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  AUTH_URL: z.string().url(),
  DEFAULT_CURRENCY: z.literal('INR').default('INR'),

  // Optional: object storage for delivery proof photos (§23). Off unless set.
  STORAGE_ENDPOINT: z.string().url().optional(),
  STORAGE_BUCKET: z.string().min(1).optional(),
  STORAGE_ACCESS_KEY_ID: z.string().min(1).optional(),
  STORAGE_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  STORAGE_REGION: z.string().min(1).optional(),

  // Optional: error tracking (§21). No-op unless set.
  SENTRY_DSN: z.string().url().optional(),

  // In-process rate limiting — single app instance in V1 (§23).
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

/** A raw environment bag — `process.env`, or a fixture in tests. */
export type EnvSource = Record<string, string | undefined>;

/** Thrown when the process environment does not satisfy the contract. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';

  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
  }
}

/**
 * Validate a raw environment bag. Pure — the caller supplies the source, which is
 * what makes fail-closed behaviour testable without mutating `process.env`.
 *
 * @throws {ConfigError} when a required key is missing or a value is invalid.
 */
export function loadConfig(source: EnvSource = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigError(issues);
  }
  return Object.freeze(parsed.data);
}

let cached: AppConfig | undefined;

/**
 * The process-wide config. Loaded once, on first use; a failure here is fatal by
 * design — the app refuses to boot on missing/invalid env (§22).
 */
export function getConfig(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

/** Test seam: drop the memoised config so the next `getConfig()` re-reads env. */
export function resetConfigForTests(): void {
  cached = undefined;
}

export function isProduction(config: AppConfig = getConfig()): boolean {
  return config.APP_ENV === 'production';
}
