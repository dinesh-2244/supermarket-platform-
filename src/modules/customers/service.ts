/**
 * Use-cases for `customers` (D6/D7, ADR-0010).
 *
 * ## A shopper is a different kind of person from a member of staff
 *
 * Not a weaker one — a different one. They have their own table of grants
 * (`CUSTOMER_GRANTS`), their own session table, their own cookie and their own
 * password rules, and none of it is shared with `identity`. The isolation is
 * therefore **structural**: a staff cookie names no `CustomerSession` row and a
 * customer cookie names no `Session` row, so no coding error can make one act
 * as the other.
 *
 * ## What is deliberately missing
 *
 * **Password reset.** It needs an email vendor, which is not wired (the same
 * posture as phone-OTP, which stays behind `FeatureFlag.customer_otp_login`).
 * A shopper who forgets their password cannot currently recover the account;
 * this is a documented gap, not an oversight, and the `NotificationProvider`
 * seam it will use already exists.
 *
 * **Rate limiting.** Phase 6. The flows here are written to be limiter-friendly
 * — uniform responses, constant work on every path — but nothing counts
 * attempts yet.
 */
import argon2 from 'argon2';
import {
  ConflictError,
  emit,
  newId,
  NotFoundError,
  sessionToken,
  ValidationError,
  withTransaction,
  type Principal,
  type Tx,
} from '../platform/index';
import { isDeliverableArea } from '../stores/index';
import {
  assertCustomerName,
  assertCustomerPassword,
  CUSTOMER_SESSION_MAX_AGE_SECONDS,
  descriptor,
  normalizeCustomerEmail,
  normalizePhone,
  type CustomerProfile,
  type ModuleDescriptor,
} from './domain/index';
import * as repo from './repo';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

export type { AddressRecord } from './repo';

/**
 * argon2**id**, at the same cost as staff (arch §20).
 *
 * Spelled out here rather than imported from `identity`: a shopper's password
 * is not a member of staff's, the two modules must not depend on each other,
 * and a shared constant is exactly how one of them would later be "tuned" on
 * behalf of the other.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

function hash(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

/**
 * A real hash of a value nobody can supply, computed once.
 *
 * It has to be a *real* argon2 hash: a hand-written constant makes
 * `argon2.verify` reject the input as malformed almost instantly, restoring the
 * timing difference this exists to remove.
 */
let dummyHashPromise: Promise<string> | null = null;

function dummyHash(): Promise<string> {
  dummyHashPromise ??= hash(`no-such-customer-${newId()}`);
  return dummyHashPromise;
}

// ---------------------------------------------------------------------------
// Sign up
// ---------------------------------------------------------------------------

export interface SignUpInput {
  readonly name: string;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
}

/**
 * Create an account — and **do not sign the shopper in**.
 *
 * That is the whole enumeration defence. Any sign-up that signs you in
 * immediately tells an attacker whether an address was already taken, because
 * "you are now signed in" and "you are not" are different outcomes however
 * carefully the message is worded. Returning the same neutral result either
 * way, and asking everyone to sign in as a second step, is the only version of
 * this that does not leak while there is no email vendor to verify with.
 *
 * The duplicate path still hashes a password, so the two cost the same.
 */
export async function signUp(input: SignUpInput): Promise<void> {
  const name = assertCustomerName(input.name);
  const email = normalizeCustomerEmail(input.email);
  const phone = normalizePhone(input.phone);
  assertCustomerPassword(input.password);

  // Always hashed, even when the account will not be created.
  const passwordHash = await hash(input.password);

  const existingEmail = await repo.findByEmailWithSecret(email);
  const existingPhone = await repo.findByPhone(phone);
  if (existingEmail !== null || existingPhone !== null) return;

  const customer = await withTransaction(async (tx) =>
    repo.insertCustomer(tx, { name, email, phone, passwordHash }),
  );
  emit('customer.registered', { customerId: customer.id });
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

/**
 * Check an email and password.
 *
 * Returns `null` for *every* failure — unknown email, wrong password, blocked
 * account, an account with no password set — and always performs a real
 * verification, so neither the caller nor anyone timing it can tell which.
 */
export async function verifyCustomerCredentials(
  email: string,
  password: string,
): Promise<CustomerProfile | null> {
  let normalized: string;
  try {
    normalized = normalizeCustomerEmail(email);
  } catch {
    normalized = '';
  }

  const customer = normalized === '' ? null : await repo.findByEmailWithSecret(normalized);
  const stored = customer?.passwordHash ?? (await dummyHash());

  let ok = false;
  try {
    ok = await argon2.verify(stored, password);
  } catch {
    ok = false;
  }

  if (customer === null || !ok || customer.isBlocked || customer.passwordHash === null) {
    return null;
  }
  return {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    isBlocked: customer.isBlocked,
  };
}

export interface ActiveCustomerSession {
  readonly token: string;
  readonly expiresAt: Date;
  readonly customer: CustomerProfile;
  readonly principal: Principal;
}

/** Mint a session for a shopper who has just proved their password. */
export async function createSessionForCustomer(
  customerId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = sessionToken();
  const expiresAt = new Date(Date.now() + CUSTOMER_SESSION_MAX_AGE_SECONDS * 1000);
  await repo.insertSession(token, customerId, expiresAt);
  return { token, expiresAt };
}

/**
 * Resolve a session token to a live shopper, or `null`.
 *
 * Re-read on **every** request rather than trusted from the cookie, so blocking
 * an account takes effect on the next page load. An expired row is deleted as
 * it is found. `storeId` is supplied by the caller from the store context: who
 * you are and which shop you are looking at are separate questions.
 */
export async function readCustomerSession(
  token: string,
  storeId: string | null = null,
): Promise<ActiveCustomerSession | null> {
  const found = await repo.findSessionWithCustomer(token);
  if (found === null) return null;

  if (found.session.expiresAt.getTime() <= Date.now()) {
    await repo.deleteSession(token);
    return null;
  }
  if (found.customer.isBlocked) {
    await repo.deleteSession(token);
    return null;
  }

  return {
    token,
    expiresAt: found.session.expiresAt,
    customer: found.customer,
    principal: { kind: 'customer', customerId: found.customer.id, storeId },
  };
}

/** Sign out: the row goes, so the cookie is worthless immediately. */
export async function destroyCustomerSession(token: string): Promise<void> {
  await repo.deleteSession(token);
}

export async function purgeExpiredCustomerSessions(now: Date = new Date()): Promise<number> {
  return repo.deleteExpiredSessions(now);
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

/** A shopper's own profile. `customerId` comes from the session, never a form. */
/**
 * Find-or-create the lightweight `Customer` a placed order hangs on.
 *
 * Called by `checkout.placeOrder` inside the placing transaction, so a customer
 * row is never created for an order that rolls back. No password, no email, no
 * session — signing up stays a separate, optional decision (ADR-0010).
 */
export async function upsertCheckoutCustomer(
  tx: Tx,
  input: { phone: string; name: string },
): Promise<CustomerProfile> {
  return repo.upsertByPhone(tx, {
    phone: normalizePhone(input.phone),
    name: assertCustomerName(input.name),
  });
}

export async function getProfile(principal: Principal): Promise<CustomerProfile> {
  const customerId = requireCustomer(principal);
  const customer = await repo.findCustomer(customerId);
  if (customer === null) throw new NotFoundError('Account not found', {});
  return customer;
}

export async function updateProfile(
  principal: Principal,
  input: { name?: string; phone?: string },
): Promise<CustomerProfile> {
  const customerId = requireCustomer(principal);

  const data: { name?: string; phone?: string } = {};
  if (input.name !== undefined) data.name = assertCustomerName(input.name);
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    const owner = await repo.findByPhone(phone);
    if (owner !== null && owner.id !== customerId) {
      throw new ConflictError('That phone number is already in use', {});
    }
    data.phone = phone;
  }
  if (Object.keys(data).length === 0) return getProfile(principal);

  return withTransaction(async (tx) => repo.updateCustomerRow(tx, customerId, data));
}

/**
 * Change a password, which **ends every session** the shopper has.
 *
 * The point of changing a password is usually that somebody else may know the
 * old one; leaving their other sessions alive would defeat it. The current
 * password is required, so a borrowed browser cannot lock the owner out.
 */
export async function changePassword(
  principal: Principal,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const customerId = requireCustomer(principal);
  assertCustomerPassword(input.newPassword);

  const customer = await repo.findByIdWithSecret(customerId);
  if (customer === null) throw new NotFoundError('Account not found', {});

  const stored = customer.passwordHash ?? (await dummyHash());
  let ok = false;
  try {
    ok = await argon2.verify(stored, input.currentPassword);
  } catch {
    ok = false;
  }
  if (!ok || customer.passwordHash === null) {
    throw new ValidationError('That is not your current password', {});
  }

  const passwordHash = await hash(input.newPassword);
  await withTransaction(async (tx) => {
    await repo.updateCustomerRow(tx, customerId, { passwordHash });
    await repo.deleteSessionsForCustomer(tx, customerId);
  });
}

// ---------------------------------------------------------------------------
// Address book
// ---------------------------------------------------------------------------

export interface AddressInput {
  readonly label?: string | null;
  readonly line1: string;
  readonly line2?: string | null;
  readonly landmark?: string | null;
  readonly areaId?: string | null;
  readonly pincode?: string | null;
  readonly isDefault?: boolean;
}

export async function listAddresses(principal: Principal): Promise<readonly repo.AddressRecord[]> {
  return repo.listAddresses(requireCustomer(principal));
}

/**
 * One address — looked up by id **and** owner.
 *
 * Never by id alone: an address id from another shopper must be a "not found",
 * and the only reliable way to guarantee that is for the query never to be able
 * to return somebody else's row.
 */
export async function getAddress(
  principal: Principal,
  addressId: string,
): Promise<repo.AddressRecord> {
  const address = await repo.findAddress(requireCustomer(principal), addressId);
  if (address === null) throw new NotFoundError('Address not found', {});
  return address;
}

export async function addAddress(
  principal: Principal,
  input: AddressInput,
): Promise<repo.AddressRecord> {
  const customerId = requireCustomer(principal);
  const fields = await validateAddress(input);

  return withTransaction(async (tx) => {
    // Before the count, not after: "is this the first address?" and "who is the
    // default now?" are both questions about the whole address book, and two
    // transactions that answer them concurrently each miss the other's
    // uncommitted row (R2).
    await repo.lockAddressBook(tx, customerId);

    // The first address a shopper saves is their default whether they said so or
    // not — an address book with no default is one checkout has to guess from.
    const existing = await repo.countAddresses(customerId, tx);
    const isDefault = input.isDefault === true || existing === 0;

    const address = await repo.insertAddress(tx, { customerId, ...fields, isDefault });
    if (isDefault) await repo.clearDefaults(tx, customerId, address.id);
    return address;
  });
}

export async function updateAddress(
  principal: Principal,
  addressId: string,
  input: AddressInput,
): Promise<repo.AddressRecord> {
  const customerId = requireCustomer(principal);
  // Validation first, because it asks `stores` whether an area is deliverable
  // and there is no reason to hold the address-book lock across that.
  const fields = await validateAddress(input);

  return withTransaction(async (tx) => {
    await repo.lockAddressBook(tx, customerId);
    // Ownership and existence are read *after* the lock. A pre-lock read is a
    // statement about the address book as it was before whoever we queued
    // behind changed it — and acting on it can revive a row a concurrent
    // removal has already soft-deleted.
    await requireOwnedAddress(tx, customerId, addressId);

    const address = await repo.updateAddressRow(tx, addressId, {
      ...fields,
      ...(input.isDefault === true ? { isDefault: true } : {}),
    });
    if (input.isDefault === true) await repo.clearDefaults(tx, customerId, addressId);
    return address;
  });
}

/**
 * Soft-delete.
 *
 * Phase 4's orders will reference the address they were delivered to, so a hard
 * delete would erase where a past order actually went. If the default is
 * removed, another address inherits it — an address book with none is one
 * checkout has to guess from.
 */
export async function removeAddress(principal: Principal, addressId: string): Promise<void> {
  const customerId = requireCustomer(principal);

  await withTransaction(async (tx) => {
    // Removing the default hands it to another address, which is a decision
    // about the whole book and so takes the same lock the other two do — a
    // removal racing an insert must not end with two defaults or none.
    await repo.lockAddressBook(tx, customerId);

    // `isDefault` is re-read here, under the lock, and this is the whole fix.
    // Reading it beforehand answered a question about the address book as it
    // was *before* we queued: a removal that started while another request was
    // promoting this very address saw `isDefault: false`, deleted the row that
    // had since become the default, and skipped the handover — leaving an
    // address book with live addresses and no default at all.
    const address = await requireOwnedAddress(tx, customerId, addressId);

    await repo.updateAddressRow(tx, addressId, { isDeleted: true, isDefault: false });
    if (!address.isDefault) return;

    const remaining = await repo.listAddresses(customerId, tx);
    const next = remaining.find((row) => row.id !== addressId);
    if (next !== undefined) await repo.updateAddressRow(tx, next.id, { isDefault: true });
  });
}

/**
 * The shopper's own live address, as it stands *now*.
 *
 * Deliberately inside the caller's transaction and after its lock: this is the
 * row every decision below it is made from, so reading it any earlier makes
 * those decisions statements about a past that may no longer be true. A row
 * another request has soft-deleted in the meantime is a "not found" here, which
 * is also what stops an update reviving it.
 */
async function requireOwnedAddress(
  tx: Tx,
  customerId: string,
  addressId: string,
): Promise<repo.AddressRecord> {
  const address = await repo.findAddress(customerId, addressId, tx);
  if (address === null) throw new NotFoundError('Address not found', {});
  return address;
}

async function validateAddress(input: AddressInput): Promise<{
  label: string | null;
  line1: string;
  line2: string | null;
  landmark: string | null;
  areaId: string | null;
  pincode: string | null;
}> {
  const line1 = input.line1.trim();
  if (line1 === '') throw new ValidationError('The address line is required', {});
  if (line1.length > 200) throw new ValidationError('That address line is too long', {});

  const areaId = input.areaId ?? null;
  // An address pointing at an area nobody delivers to would silently fail at
  // checkout, so it is refused here where the shopper can still fix it.
  //
  // Asked of `stores` rather than answered here. DeliveryArea is that module's
  // model (§4), and reading it from this repository was both a boundary
  // violation the path lint could not see and a *different rule*: it tested the
  // area's own `isActive` flag and nothing about the zone or the store above it,
  // so an address in a retired zone or a closed store was accepted (R7).
  if (areaId !== null && !(await isDeliverableArea(areaId))) {
    throw new ValidationError('Choose a delivery area from the list', {});
  }

  const pincode = (input.pincode ?? '').replace(/\D/g, '');
  if (pincode !== '' && pincode.length !== 6) {
    throw new ValidationError('A pincode is six digits', {});
  }

  return {
    label: emptyToNull(input.label),
    line1,
    line2: emptyToNull(input.line2),
    landmark: emptyToNull(input.landmark),
    areaId,
    pincode: pincode === '' ? null : pincode,
  };
}

function emptyToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * The signed-in shopper, or a refusal.
 *
 * A staff `user` principal is refused here as firmly as an anonymous one: the
 * back office has no account area, and treating a member of staff as a customer
 * is exactly the confusion ADR-0010 exists to make impossible.
 */
function requireCustomer(principal: Principal): string {
  if (principal.kind !== 'customer' || principal.customerId === null) {
    throw new NotFoundError('You need to be signed in to do that', {});
  }
  return principal.customerId;
}
