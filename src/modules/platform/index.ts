/**
 * `platform` — the shared kernel (architecture §4). Every other module depends on
 * this and on nothing else in `src/modules`. This file is its only public surface.
 */

export {
  type AppConfig,
  ConfigError,
  type EnvSource,
  getConfig,
  isProduction,
  loadConfig,
  resetConfigForTests,
} from './config/index.js';

export {
  childLogger,
  getLogger,
  getRequestContext,
  type RequestContext,
  withRequestContext,
} from './logger/index.js';

export {
  checkDbHealth,
  type DbExecutor,
  type DbHealth,
  getPrisma,
  type LockedInventoryRow,
  Prisma,
  selectForUpdate,
  selectManyForUpdate,
  type TransactionOptions,
  type Tx,
  withTransaction,
} from './db/index.js';

export {
  AppError,
  type AppErrorCode,
  AuthzError,
  ConflictError,
  DomainError,
  type ErrorResponse,
  type ErrorResponseBody,
  isAppError,
  NotFoundError,
  toErrorResponse,
  ValidationError,
} from './errors/index.js';

export {
  clearEventHandlersForTests,
  type DomainEventName,
  type DomainEvents,
  emit,
  type EventHandler,
  on,
  registerEventHandlers,
} from './event-bus/index.js';

export {
  add,
  format,
  fromRupees,
  max,
  min,
  mul,
  paise,
  type Paise,
  percentBp,
  subtract,
  ZERO,
} from './money/index.js';

export { cartToken, newId, orderNumber, requestId, trackingToken } from './ids/index.js';

export {
  type Action,
  allowedStoreIds,
  assertAuthorized,
  authorize,
  type AuthzDecision,
  isUnscoped,
  type Principal,
  type Resource,
  type UserRole,
} from './authz/index.js';

export {
  captureException,
  captureMessage,
  type ErrorContext,
  type ObservabilityProvider,
  resetObservabilityProvider,
  setObservabilityProvider,
} from './observability/index.js';
