import { AsyncLocalStorage } from 'node:async_hooks';
import pino, { type Logger } from 'pino';
import { getConfig } from '../config/index.js';

export interface RequestContext {
  readonly requestId: string;
  readonly actorId?: string;
  readonly actorType?: 'user' | 'customer' | 'system';
}

const requestContext = new AsyncLocalStorage<RequestContext>();

/** The current request's correlation context, if we are inside one. */
export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

/** Run `fn` with a correlation context; every log line inside inherits it. */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContext.run(context, fn);
}

function createLogger(): Logger {
  // Read config defensively: logging must not be the thing that crashes a boot
  // failure report. `getConfig()` throwing here would hide the real error.
  let level = 'info';
  let appEnv = 'local';
  try {
    const config = getConfig();
    level = config.LOG_LEVEL;
    appEnv = config.APP_ENV;
  } catch {
    // Fall through with defaults; `config` reports the real problem.
  }

  return pino({
    level,
    base: { app: 'supermarket-platform', env: appEnv },
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Correlation id is attached per-line rather than per-child logger so that
    // ambient module-level loggers pick it up automatically.
    mixin() {
      const context = getRequestContext();
      return context ? { ...context } : {};
    },
    redact: {
      paths: [
        'password',
        'passwordHash',
        'AUTH_SECRET',
        'DATABASE_URL',
        '*.password',
        '*.passwordHash',
        'req.headers.authorization',
        'req.headers.cookie',
      ],
      censor: '[redacted]',
    },
  });
}

let rootLogger: Logger | undefined;

/** Process-wide structured JSON logger (§21). */
export function getLogger(): Logger {
  rootLogger ??= createLogger();
  return rootLogger;
}

/** A named child logger, e.g. `childLogger('inventory')`. */
export function childLogger(name: string, bindings: Record<string, unknown> = {}): Logger {
  return getLogger().child({ module: name, ...bindings });
}
