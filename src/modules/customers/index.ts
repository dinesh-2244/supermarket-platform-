/**
 * `customers` — public surface. Owns: Customer, CustomerAddress,
 * CustomerSession, OtpChallenge (disabled), optional accounts.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  addAddress,
  changePassword,
  createSessionForCustomer,
  destroyCustomerSession,
  getAddress,
  getProfile,
  listAddresses,
  moduleDescriptor,
  purgeExpiredCustomerSessions,
  readCustomerSession,
  removeAddress,
  signUp,
  updateAddress,
  updateProfile,
  verifyCustomerCredentials,
  type ActiveCustomerSession,
  type AddressInput,
  type AddressRecord,
  type SignUpInput,
} from './service';

export {
  assertCustomerName,
  assertCustomerPassword,
  CUSTOMER_SESSION_MAX_AGE_SECONDS,
  MIN_CUSTOMER_PASSWORD_LENGTH,
  normalizeCustomerEmail,
  normalizePhone,
  type CustomerProfile,
  type ModuleDescriptor,
} from './domain/index';
