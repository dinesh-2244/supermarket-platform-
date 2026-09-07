/**
 * `identity` — public surface. Owns: User, RBAC, staff authentication.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  type ActiveSession,
  canManageStoreUsers,
  changeOwnPassword,
  createSessionForUser,
  createUser,
  type CreateUserInput,
  destroySession,
  getUser,
  hashPassword,
  listUsers,
  moduleDescriptor,
  principalForUserId,
  purgeExpiredSessions,
  readSession,
  resetPassword,
  setUserActive,
  updateUser,
  type UpdateUserInput,
  type AuthenticatedUser,
  type UserRecord,
  verifyCredentials,
} from './service';

export {
  assignableRoles,
  MIN_PASSWORD_LENGTH,
  SESSION_MAX_AGE_SECONDS,
  normalizeEmail,
  principalForUser,
  USER_ROLES,
  type ModuleDescriptor,
  type PrincipalSource,
} from './domain/index';
