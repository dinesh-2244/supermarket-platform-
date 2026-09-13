/**
 * Pure domain logic for `product-requests` — no I/O, no Prisma, no framework
 * types.
 *
 * A shopper asking for something the shelf does not carry (Phase 5.5). This is
 * intake and triage only: nothing here touches stock, orders, pricing or the
 * POS, and a request never becomes an order by itself.
 */
import { ConflictError, ValidationError } from '../../platform/index';

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'product-requests',
  owns: 'ProductRequest, ProductRequestStatusHistory',
  dependsOn: ['platform', 'stores'],
  emits: [],
};

export type ProductRequestStatus = 'NEW' | 'REVIEWED' | 'PLANNED' | 'DECLINED' | 'FULFILLED';

export const PRODUCT_REQUEST_STATUSES: readonly ProductRequestStatus[] = [
  'NEW',
  'REVIEWED',
  'PLANNED',
  'DECLINED',
  'FULFILLED',
];

/**
 * Where triage may go from each state.
 *
 * `NEW` is where every request starts. `FULFILLED` is terminal: the shelf now
 * carries it, and there is nothing left to decide. `DECLINED` can be reopened
 * to `REVIEWED` — suppliers change — but not jumped straight to a plan or a
 * fulfilment, so the reversal itself is a recorded step.
 */
export const REQUEST_TRANSITIONS: Readonly<
  Record<ProductRequestStatus, readonly ProductRequestStatus[]>
> = {
  NEW: ['REVIEWED', 'PLANNED', 'DECLINED', 'FULFILLED'],
  REVIEWED: ['PLANNED', 'DECLINED', 'FULFILLED'],
  PLANNED: ['REVIEWED', 'DECLINED', 'FULFILLED'],
  DECLINED: ['REVIEWED'],
  FULFILLED: [],
};

/**
 * Check a triage step, or throw. Declining needs a reason — it is the one
 * outcome the shopper would want explained, and the history row is where it
 * lives.
 */
export function assertRequestTransition(
  from: ProductRequestStatus,
  to: ProductRequestStatus,
  note: string | null | undefined,
): void {
  if (from === to) {
    throw new ConflictError(`That request is already ${to}`, { from, to });
  }
  if (!REQUEST_TRANSITIONS[from].includes(to)) {
    throw new ConflictError(`A ${from} request cannot be moved to ${to}`, { from, to });
  }
  if (to === 'DECLINED' && (note ?? '').trim().length === 0) {
    throw new ValidationError('Declining a request needs a reason', { from, to });
  }
}

export interface SubmissionInput {
  /**
   * An opaque, stable identifier for the *client* — the storefront passes a
   * hash of its basket cookie, or failing that the request address. Required
   * for a guest who gives no phone: it is the only handle the intake caps have
   * on them. Never the raw cookie, and never shown to anyone.
   */
  readonly clientKey?: string | null;
  readonly productName: string;
  readonly brand?: string | null;
  readonly packSize?: string | null;
  readonly note?: string | null;
  readonly customerName?: string | null;
  readonly customerPhone?: string | null;
}

export interface Submission {
  readonly productName: string;
  readonly brand: string | null;
  readonly packSize: string | null;
  readonly note: string | null;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
}

const LIMITS = {
  productName: 120,
  brand: 80,
  packSize: 60,
  note: 500,
  customerName: 120,
} as const;

function optional(value: string | null | undefined, field: keyof typeof LIMITS): string | null {
  const trimmed = (value ?? '').trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > LIMITS[field]) {
    throw new ValidationError(`That ${label(field)} is too long`, { field });
  }
  return trimmed;
}

function label(field: keyof typeof LIMITS): string {
  return field === 'productName'
    ? 'product name'
    : field === 'packSize'
      ? 'pack size'
      : field === 'customerName'
        ? 'name'
        : field;
}

/**
 * The form, cleaned. Only the product name is required; everything else is
 * trimmed and blanked to `null`. Lengths are capped so a public form cannot be
 * used as free storage, and the phone — when given — is kept as the digits
 * people dial, the way `customers` keeps it.
 */
export function validateSubmission(input: SubmissionInput): Submission {
  const productName = (input.productName ?? '').trim();
  if (productName.length === 0) {
    throw new ValidationError('Tell us the product name', { field: 'productName' });
  }
  if (productName.length > LIMITS.productName) {
    throw new ValidationError('That product name is too long', { field: 'productName' });
  }
  const phone = (input.customerPhone ?? '').trim();
  return {
    productName,
    brand: optional(input.brand, 'brand'),
    packSize: optional(input.packSize, 'packSize'),
    note: optional(input.note, 'note'),
    customerName: optional(input.customerName, 'customerName'),
    customerPhone: phone.length === 0 ? null : normalizeIndianMobile(phone),
  };
}

/** Same rule as `customers.normalizePhone`, kept here so this module stays off `customers`. */
function normalizeIndianMobile(phone: string): string {
  const digits = phone.replace(/[\s()-]/g, '');
  if (!/^(\+91)?[6-9]\d{9}$/.test(digits)) {
    throw new ValidationError('Enter a 10-digit Indian mobile number', { field: 'customerPhone' });
  }
  return digits.replace(/^\+91/, '');
}

/**
 * Intake caps. A public write endpoint with no login needs a ceiling, and this
 * is the whole of it: one submitter gets a handful a day, one store gets a
 * bounded trickle per window, and the same ask twice from the same person in a
 * day is a double-submit rather than a new row. Small numbers on purpose — a
 * shop hears about a few missing products a day, not hundreds.
 */
export const INTAKE_LIMITS = {
  perSubmitter: { max: 5, windowMs: 24 * 60 * 60 * 1000 },
  perStore: { max: 30, windowMs: 10 * 60 * 1000 },
  duplicate: { windowMs: 24 * 60 * 60 * 1000 },
} as const;

/**
 * Who is submitting, as one string the caps can count by: the account when
 * there is one, else the phone they gave, else the client key the storefront
 * supplied. A guest with none of these has nothing to bound them and is
 * refused — that is a storefront wiring mistake, not a shopper's.
 */
export function submitterKeyOf(who: {
  readonly customerId: string | null;
  readonly customerPhone: string | null;
  readonly clientKey: string | null | undefined;
}): string {
  if (who.customerId !== null) return `customer:${who.customerId}`;
  if (who.customerPhone !== null) return `phone:${who.customerPhone}`;
  const key = (who.clientKey ?? '').trim();
  if (key.length === 0) {
    throw new ValidationError(
      'A product request needs a client key when the shopper is anonymous',
      {
        field: 'clientKey',
      },
    );
  }
  return `client:${key}`;
}

/** The product name folded for duplicate detection: case and spacing do not make a new ask. */
export function productKeyOf(productName: string): string {
  return productName.trim().toLowerCase().replace(/\s+/g, ' ');
}
