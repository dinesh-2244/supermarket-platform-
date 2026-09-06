import { ValidationError } from '../errors/index';

/**
 * Integer paise. Floats are banned for currency (§17); the brand makes an
 * accidental rupee/paise mix-up a type error.
 */
export type Paise = number & { readonly __brand: 'Paise' };

export const ZERO: Paise = 0 as Paise;

/** Build a `Paise` value, rejecting anything that is not a safe integer. */
export function paise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError('Money must be a whole number of paise', { value });
  }
  return value as Paise;
}

/** Convert whole/decimal rupees to paise, rounding half-up at 2 decimals. */
export function fromRupees(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new ValidationError('Rupee amount must be finite', { rupees });
  }
  return paise(Math.round(rupees * 100));
}

export function add(...amounts: readonly Paise[]): Paise {
  return paise(amounts.reduce<number>((sum, amount) => sum + amount, 0));
}

export function subtract(a: Paise, b: Paise): Paise {
  return paise(a - b);
}

/**
 * Multiply money by a quantity or rate. Rounds half-up so a line total never
 * loses a paisa to floating point.
 */
export function mul(amount: Paise, factor: number): Paise {
  if (!Number.isFinite(factor)) {
    throw new ValidationError('Multiplier must be finite', { factor });
  }
  return paise(Math.round(amount * factor));
}

/** Basis points of an amount, e.g. `percentBp(10_000, 500)` → 5% of ₹100. */
export function percentBp(amount: Paise, bp: number): Paise {
  return mul(amount, bp / 10_000);
}

export function min(a: Paise, b: Paise): Paise {
  return a <= b ? a : b;
}

export function max(a: Paise, b: Paise): Paise {
  return a >= b ? a : b;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Human-readable INR, e.g. `format(paise(123450))` → "₹1,234.50". */
export function format(amount: Paise): string {
  return inrFormatter.format(amount / 100);
}
