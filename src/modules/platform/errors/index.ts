/**
 * Typed error hierarchy (§17/§21). Modules throw these; only the edge — a route
 * handler or server action — maps them to HTTP/UI via `toErrorResponse`.
 */
export type AppErrorCode =
  'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'FORBIDDEN' | 'DOMAIN_RULE' | 'INTERNAL';

export abstract class AppError extends Error {
  abstract readonly code: AppErrorCode;
  abstract readonly httpStatus: number;

  /** Safe to show a customer/staff member: contains no internals. */
  readonly expose: boolean = true;

  constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  override readonly code = 'VALIDATION' as const;
  override readonly httpStatus = 400;
}

export class NotFoundError extends AppError {
  override readonly code = 'NOT_FOUND' as const;
  override readonly httpStatus = 404;
}

export class ConflictError extends AppError {
  override readonly code = 'CONFLICT' as const;
  override readonly httpStatus = 409;
}

export class AuthzError extends AppError {
  override readonly code = 'FORBIDDEN' as const;
  override readonly httpStatus = 403;
}

/** A business rule said no — e.g. an illegal order-status transition. */
export class DomainError extends AppError {
  override readonly code = 'DOMAIN_RULE' as const;
  override readonly httpStatus = 422;
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export interface ErrorResponseBody {
  readonly error: {
    readonly code: AppErrorCode;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>>;
    readonly requestId?: string;
  };
}

export interface ErrorResponse {
  readonly status: number;
  readonly body: ErrorResponseBody;
}

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/**
 * The single edge mapper. Unknown errors never leak their message or stack to a
 * client — that detail belongs in the logs and in Sentry, not in the response.
 */
export function toErrorResponse(
  error: unknown,
  options: { readonly requestId?: string } = {},
): ErrorResponse {
  if (isAppError(error)) {
    return {
      status: error.httpStatus,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          ...(options.requestId ? { requestId: options.requestId } : {}),
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL',
        message: GENERIC_MESSAGE,
        ...(options.requestId ? { requestId: options.requestId } : {}),
      },
    },
  };
}
