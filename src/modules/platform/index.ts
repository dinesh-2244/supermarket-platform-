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
} from './config/index';

export {
  childLogger,
  getLogger,
  getRequestContext,
  type RequestContext,
  withRequestContext,
} from './logger/index';

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
} from './db/index';

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
} from './errors/index';

export {
  clearEventHandlersForTests,
  type DomainEventName,
  type DomainEvents,
  emit,
  type EventHandler,
  on,
  registerEventHandlers,
} from './event-bus/index';

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
} from './money/index';

export { cartToken, newId, orderNumber, requestId, trackingToken } from './ids/index';

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
} from './authz/index';

export {
  captureException,
  captureMessage,
  type ErrorContext,
  type ObservabilityProvider,
  resetObservabilityProvider,
  setObservabilityProvider,
} from './observability/index';
