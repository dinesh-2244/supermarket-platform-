/**
 * Pure domain logic for `customers` — no I/O, no Prisma, no framework types.
 *
 * A shopper is **not** a weak member of staff. The rules here are deliberately
 * their own, in their own module, so that nothing written for `identity` can
 * drift into applying to customers or the other way round (ADR-0010).
 */
import { ValidationError } from '../../platform/index';

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'customers',
  owns: 'Customer, CustomerAddress, CustomerSession, OtpChallenge (disabled), optional accounts',
  dependsOn: ['platform', 'notifications'],
  emits: ['customer.registered'],
};

/**
 * How long a shopper stays signed in.
 *
 * Longer than a staff session (which is a working day) and shorter than the
 * basket cookie (which is a year): signing in is a convenience for someone who
 * shops every week or two, and the account holds an address book rather than
 * the power to reprice a shelf.
 */
export const CUSTOMER_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Shorter than the staff minimum of 12, and deliberately so.
 *
 * A staff password guards every store's pricing and stock; a customer's guards
 * their own address book. Setting the bar where people will not meet it pushes
 * them to reuse a password they already have, which is worse for them than
 * eight characters they chose. Rate limiting is Phase 6 and noted as absent.
 */
export const MIN_CUSTOMER_PASSWORD_LENGTH = 8;

export function assertCustomerPassword(password: string): void {
  if (password.length < MIN_CUSTOMER_PASSWORD_LENGTH) {
    throw new ValidationError(
      `Password must be at least ${String(MIN_CUSTOMER_PASSWORD_LENGTH)} characters`,
      { length: password.length },
    );
  }
  if (password.trim().length === 0) {
    throw new ValidationError('Password must not be only whitespace', {});
  }
}

/** Lower-cased and trimmed, so `A@b.com` and `a@b.com` cannot become two accounts. */
export function normalizeCustomerEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  // Deliberately permissive: one `@`, something either side, no whitespace.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ValidationError('Enter a valid email address', {});
  }
  return normalized;
}

export function assertCustomerName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new ValidationError('Name is required', {});
  if (trimmed.length > 120) throw new ValidationError('That name is too long', {});
  return trimmed;
}

/**
 * A phone number, kept as the digits people actually dial.
 *
 * Stored normalised so the same person cannot end up as two customers by typing
 * `+91 98765 43210` one day and `9876543210` the next — `Customer.phone` is
 * unique, and Phase 4 upserts an order's customer by it.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[\s()-]/g, '');
  if (!/^(\+91)?[6-9]\d{9}$/.test(digits)) {
    throw new ValidationError('Enter a 10-digit Indian mobile number', {});
  }
  return digits.replace(/^\+91/, '');
}

/** A shopper's own view of their account. Never carries the password hash. */
export interface CustomerProfile {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string;
  readonly isBlocked: boolean;
}
