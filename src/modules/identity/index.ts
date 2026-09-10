/**
 * `identity` — public surface. Owns: User, RBAC, staff authentication.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  type ActiveSession,
  beginTotpEnrolment,
  canManageStoreUsers,
  changeOwnPassword,
  confirmTotpEnrolment,
  createSessionForUser,
  createUser,
  type CreateUserInput,
  destroySession,
  disableTotp,
  getUser,
  hashPassword,
  hasTotpEnrolled,
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
  type TotpEnrolment,
  type UserRecord,
  verifyCredentials,
} from './service';

export {
  assertCanManageTarget,
  assignableRoles,
  manageableRoles,
  MIN_PASSWORD_LENGTH,
  SESSION_MAX_AGE_SECONDS,
  normalizeEmail,
  principalForUser,
  USER_ROLES,
  type ModuleDescriptor,
  type PrincipalSource,
} from './domain/index';
