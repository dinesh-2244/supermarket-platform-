import { getConfig } from '../config/index.js';
import { childLogger } from '../logger/index.js';
import { getRequestContext } from '../logger/index.js';

export type ErrorContext = Readonly<Record<string, unknown>>;

/**
 * Error-tracking seam (§21). Sentry/GlitchTip is optional for the pilot, so this
 * is a no-op unless `SENTRY_DSN` is configured — everything still reaches the
 * structured log either way. The real client is wired in a later phase behind
 * this same interface.
 */
export interface ObservabilityProvider {
  captureException(error: unknown, context?: ErrorContext): void;
  captureMessage(message: string, context?: ErrorContext): void;
}

const noopProvider: ObservabilityProvider = {
  captureException() {
    /* no-op */
  },
  captureMessage() {
    /* no-op */
  },
};

let provider: ObservabilityProvider = noopProvider;

/** Swap the provider (real Sentry client, or a spy in tests). */
export function setObservabilityProvider(next: ObservabilityProvider): void {
  provider = next;
}

export function resetObservabilityProvider(): void {
  provider = noopProvider;
}

function isEnabled(): boolean {
  try {
    return getConfig().SENTRY_DSN !== undefined;
  } catch {
    return false;
  }
}

export function captureException(error: unknown, context: ErrorContext = {}): void {
  const requestContext = getRequestContext();
  childLogger('observability').error(
    { err: error, ...requestContext, ...context },
    'Unhandled error',
  );
  if (isEnabled()) {
    provider.captureException(error, { ...requestContext, ...context });
  }
}

export function captureMessage(message: string, context: ErrorContext = {}): void {
  const requestContext = getRequestContext();
  childLogger('observability').warn({ ...requestContext, ...context }, message);
  if (isEnabled()) {
    provider.captureMessage(message, { ...requestContext, ...context });
  }
}
