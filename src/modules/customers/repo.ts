/**
 * Prisma / SQL access for `customers`. Private to this module: nothing outside
 * `src/modules/customers` may import this file, and `import/no-restricted-paths`
 * enforces that.
 *
 * The password hash leaves this file in exactly one shape —
 * {@link CustomerWithSecret}, returned by one function — so that "which query
 * can leak a credential?" has a one-line answer.
 */
import {
  advisoryXactLock,
  getPrisma,
  LOCK_NAMESPACE,
  type DbExecutor,
  type Tx,
} from '../platform/index';
import type { CustomerProfile } from './domain/index';

/** The executor to run a *read* on: the caller's transaction, or the singleton. */
export function executor(db?: DbExecutor): DbExecutor {
  return db ?? getPrisma();
}

/** Writes take the branded `Tx` that only `withTransaction` can mint. */
export function customerExecutor(tx: Tx): Tx {
  return tx;
}

const profileSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  isBlocked: true,
} as const;

export async function findCustomer(id: string, db?: DbExecutor): Promise<CustomerProfile | null> {
  return executor(db).customer.findUnique({ where: { id }, select: profileSelect });
}

export interface CustomerWithSecret extends CustomerProfile {
  readonly passwordHash: string | null;
}

/**
 * The one query that returns a password hash.
 *
 * By email, for sign-in; by id, for a password change. Both callers verify and
 * discard it — nothing else in the module may ask for it.
 */
export async function findByEmailWithSecret(
  email: string,
  db?: DbExecutor,
): Promise<CustomerWithSecret | null> {
  return executor(db).customer.findUnique({
    where: { email },
    select: { ...profileSelect, passwordHash: true },
  });
}

export async function findByIdWithSecret(
  id: string,
  db?: DbExecutor,
): Promise<CustomerWithSecret | null> {
  return executor(db).customer.findUnique({
    where: { id },
    select: { ...profileSelect, passwordHash: true },
  });
}

export async function findByPhone(phone: string, db?: DbExecutor): Promise<CustomerProfile | null> {
  return executor(db).customer.findUnique({ where: { phone }, select: profileSelect });
}

/**
 * Find-or-create a **lightweight** customer by phone, inside a transaction.
 *
 * Checkout needs a `Customer` row to hang the order on, and a shopper who has
 * never signed up has none. This creates the minimum — phone and name, no
 * `passwordHash`, no email — which is exactly what the schema allows (both are
 * nullable) and what "an account is optional, never a prerequisite" means.
 *
 * The name is refreshed on an existing row so a returning shopper who spells
 * their name differently sees the new one; nothing else about an existing
 * customer is touched, and in particular an account holder's credentials are
 * never disturbed by a guest checkout on the same phone number.
 */
export async function upsertByPhone(
  tx: Tx,
  row: { phone: string; name: string },
): Promise<CustomerProfile> {
  return executor(tx).customer.upsert({
    where: { phone: row.phone },
    create: { phone: row.phone, name: row.name },
    update: { name: row.name },
    select: profileSelect,
  });
}

export async function insertCustomer(
  tx: Tx,
  row: { name: string; email: string; phone: string; passwordHash: string },
): Promise<CustomerProfile> {
  return customerExecutor(tx).customer.create({ data: { ...row }, select: profileSelect });
}

export async function updateCustomerRow(
  tx: Tx,
  id: string,
  row: { name?: string; phone?: string; passwordHash?: string },
): Promise<CustomerProfile> {
  return customerExecutor(tx).customer.update({
    where: { id },
    data: { ...row },
    select: profileSelect,
  });
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface CustomerSessionRecord {
  readonly id: string;
  readonly token: string;
  readonly customerId: string;
  readonly expiresAt: Date;
}

export async function insertSession(
  token: string,
  customerId: string,
  expiresAt: Date,
  db?: DbExecutor,
): Promise<CustomerSessionRecord> {
  return executor(db).customerSession.create({
    data: { token, customerId, expiresAt },
    select: { id: true, token: true, customerId: true, expiresAt: true },
  });
}

/** The session and the shopper behind it, read together on every request. */
export async function findSessionWithCustomer(
  token: string,
  db?: DbExecutor,
): Promise<{ session: CustomerSessionRecord; customer: CustomerProfile } | null> {
  const row = await executor(db).customerSession.findUnique({
    where: { token },
    select: {
      id: true,
      token: true,
      customerId: true,
      expiresAt: true,
      customer: { select: profileSelect },
    },
  });
  if (row === null) return null;
  const { customer, ...session } = row;
  return { session, customer };
}

export async function deleteSession(token: string, db?: DbExecutor): Promise<void> {
  await executor(db).customerSession.deleteMany({ where: { token } });
}

/** Every session for one shopper — a password change ends all of them. */
export async function deleteSessionsForCustomer(tx: Tx, customerId: string): Promise<number> {
  const result = await customerExecutor(tx).customerSession.deleteMany({ where: { customerId } });
  return result.count;
}

export async function deleteExpiredSessions(now: Date, db?: DbExecutor): Promise<number> {
  const result = await executor(db).customerSession.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export interface AddressRecord {
  readonly id: string;
  readonly customerId: string;
  readonly label: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly landmark: string | null;
  readonly areaId: string | null;
  readonly pincode: string | null;
  readonly isDefault: boolean;
  readonly isDeleted: boolean;
}

const addressSelect = {
  id: true,
  customerId: true,
  label: true,
  line1: true,
  line2: true,
  landmark: true,
  areaId: true,
  pincode: true,
  isDefault: true,
  isDeleted: true,
} as const;

/**
 * A shopper's own addresses.
 *
 * The `customerId` filter is in this query rather than in the caller: an
 * address list that forgets whose it is, is an IDOR, so the module only ever
 * owns the filtered version.
 */
export async function listAddresses(
  customerId: string,
  db?: DbExecutor,
): Promise<readonly AddressRecord[]> {
  return executor(db).customerAddress.findMany({
    where: { customerId, isDeleted: false },
    select: addressSelect,
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
  });
}

/** By id **and** owner — never by id alone. */
export async function findAddress(
  customerId: string,
  addressId: string,
  db?: DbExecutor,
): Promise<AddressRecord | null> {
  return executor(db).customerAddress.findFirst({
    where: { id: addressId, customerId, isDeleted: false },
    select: addressSelect,
  });
}

export async function insertAddress(
  tx: Tx,
  row: {
    customerId: string;
    label: string | null;
    line1: string;
    line2: string | null;
    landmark: string | null;
    areaId: string | null;
    pincode: string | null;
    isDefault: boolean;
  },
): Promise<AddressRecord> {
  return customerExecutor(tx).customerAddress.create({ data: { ...row }, select: addressSelect });
}

export async function updateAddressRow(
  tx: Tx,
  addressId: string,
  row: {
    label?: string | null;
    line1?: string;
    line2?: string | null;
    landmark?: string | null;
    areaId?: string | null;
    pincode?: string | null;
    isDefault?: boolean;
    isDeleted?: boolean;
  },
): Promise<AddressRecord> {
  return customerExecutor(tx).customerAddress.update({
    where: { id: addressId },
    data: { ...row },
    select: addressSelect,
  });
}

/**
 * Serialise this shopper's "exactly one default address" rule.
 *
 * Taken **before** anything reads or decides which address is the default.
 * `clearDefaults` locks the rows it updates, which protects nothing when the
 * competing transaction's new default is a row that does not exist yet: both
 * clear the same old default, neither can see the other's insert, and both
 * commit a live default (R2).
 */
export async function lockAddressBook(tx: Tx, customerId: string): Promise<void> {
  await advisoryXactLock(tx, LOCK_NAMESPACE.customerAddresses, customerId);
}

/** Clear every other default, so exactly one survives. */
export async function clearDefaults(tx: Tx, customerId: string, exceptId: string): Promise<void> {
  await customerExecutor(tx).customerAddress.updateMany({
    where: { customerId, isDefault: true, id: { not: exceptId } },
    data: { isDefault: false },
  });
}

/** How many live addresses a shopper has — for the "first one is default" rule. */
export async function countAddresses(customerId: string, db?: DbExecutor): Promise<number> {
  return executor(db).customerAddress.count({ where: { customerId, isDeleted: false } });
}
