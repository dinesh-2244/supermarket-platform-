import { describe, expect, it } from 'vitest';
import {
  AuthzError,
  ConflictError,
  DomainError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  isAppError,
  toErrorResponse,
} from '../errors/index';

describe('platform/errors', () => {
  it.each([
    [new ValidationError('bad input'), 400, 'VALIDATION'],
    [new NotFoundError('no such order'), 404, 'NOT_FOUND'],
    [new ConflictError('already exists'), 409, 'CONFLICT'],
    [new AuthzError('nope'), 403, 'FORBIDDEN'],
    [new DomainError('illegal transition'), 422, 'DOMAIN_RULE'],
    [new RateLimitError('slow down'), 429, 'RATE_LIMITED'],
  ])('maps %s to its status and code', (error, status, code) => {
    const response = toErrorResponse(error);

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(response.body.error.message).toBe(error.message);
  });

  it('passes structured details through', () => {
    const response = toErrorResponse(new ValidationError('bad qty', { field: 'qty', got: -1 }));
    expect(response.body.error.details).toEqual({ field: 'qty', got: -1 });
  });

  it('never leaks an unknown error message or stack to the client', () => {
    const response = toErrorResponse(new Error('connect ECONNREFUSED 10.0.0.5:5432'));

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL');
    expect(response.body.error.message).toBe('Something went wrong. Please try again.');
    expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
  });

  it('handles non-Error throwables', () => {
    expect(toErrorResponse('boom').status).toBe(500);
    expect(toErrorResponse(undefined).body.error.code).toBe('INTERNAL');
  });

  it('attaches the request id for support correlation', () => {
    const response = toErrorResponse(new Error('x'), { requestId: 'req-123' });
    expect(response.body.error.requestId).toBe('req-123');
  });

  it('recognises AppError instances', () => {
    expect(isAppError(new NotFoundError('x'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
  });
});
