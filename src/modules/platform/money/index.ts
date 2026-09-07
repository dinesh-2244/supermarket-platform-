import { ValidationError } from '../errors/index';

/**
 * Integer paise. Floats are banned for currency (§17); the brand makes an
 * accidental rupee/paise mix-up a type error.
 */
export type Paise = number & { readonly __brand: 'Paise' };

export const ZERO: Paise = 0 as Paise;

/**
 * An exact decimal: `units / 10^scale`, held in `bigint` so no intermediate
 * value is ever a float.
 *
 * Every conversion into this form goes through the *shortest round-trip decimal
 * string* of the input (`String(n)`), which is the decimal literal the author
 * wrote. That is the whole point: `10.075` is stored in binary as
 * `10.0749999999999992894…`, so `Math.round(10.075 * 100)` gives 1007. Reading
 * the digits `1`,`0`,`.`,`0`,`7`,`5` instead makes the half tie visible and the
 * documented half-up rule actually apply.
 */
interface Decimal {
  readonly units: bigint;
  readonly scale: number;
}

/** `String(n)` without exponent notation, so the digits can be read directly. */
function toPlainDecimalString(value: number): string {
  const text = String(value);
  const exponentAt = text.indexOf('e');
  if (exponentAt === -1) return text;

  const exponent = Number(text.slice(exponentAt + 1));
  const mantissa = text.slice(0, exponentAt);
  const negative = mantissa.startsWith('-');
  const body = negative ? mantissa.slice(1) : mantissa;
  const pointAt = body.indexOf('.');
  const intDigits = pointAt === -1 ? body : body.slice(0, pointAt);
  const fracDigits = pointAt === -1 ? '' : body.slice(pointAt + 1);
  const digits = intDigits + fracDigits;
  const pointPosition = intDigits.length + exponent;

  let plain: string;
  if (pointPosition <= 0) {
    plain = `0.${'0'.repeat(-pointPosition)}${digits}`;
  } else if (pointPosition >= digits.length) {
    plain = digits + '0'.repeat(pointPosition - digits.length);
  } else {
    plain = `${digits.slice(0, pointPosition)}.${digits.slice(pointPosition)}`;
  }
  return negative ? `-${plain}` : plain;
}

function toDecimal(value: number): Decimal {
  const text = toPlainDecimalString(value);
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;
  const pointAt = body.indexOf('.');
  const intDigits = pointAt === -1 ? body : body.slice(0, pointAt);
  const fracDigits = pointAt === -1 ? '' : body.slice(pointAt + 1);
  const units = BigInt(`${intDigits === '' ? '0' : intDigits}${fracDigits}`);
  return { units: negative ? -units : units, scale: fracDigits.length };
}

/** `a * b` with no loss: scales add, units multiply. */
function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

function scaleBy10(value: Decimal, powers: number): Decimal {
  return powers <= value.scale
    ? { units: value.units, scale: value.scale - powers }
    : { units: value.units * 10n ** BigInt(powers - value.scale), scale: 0 };
}

/**
 * Round to a whole number, half **away from zero** — the commercial "half-up"
 * an Indian retail invoice expects (₹10.075 → ₹10.08, −₹10.075 → −₹10.08), and
 * symmetric so `mul(x, -f) === -mul(x, f)`.
 */
function roundHalfUp(value: Decimal): bigint {
  if (value.scale === 0) return value.units;
  const divisor = 10n ** BigInt(value.scale);
  const negative = value.units < 0n;
  const magnitude = negative ? -value.units : value.units;
  const quotient = magnitude / divisor;
  const remainder = magnitude % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Land an exact result back on `Paise`, rejecting anything past 2^53−1. */
function toPaise(units: bigint, context: Readonly<Record<string, unknown>>): Paise {
  if (units > MAX_SAFE || units < -MAX_SAFE) {
    throw new ValidationError('Money is outside the safe integer range', {
      ...context,
      paise: units.toString(),
    });
  }
  return Number(units) as Paise;
}

/** Build a `Paise` value, rejecting anything that is not a safe integer. */
export function paise(value: number): Paise {
  if (!Number.isSafeInteger(value)) {
    throw new ValidationError('Money must be a whole number of paise', { value });
  }
  return value as Paise;
}

/**
 * Convert whole/decimal rupees to paise, rounding half-up at 2 decimals.
 *
 * `fromRupees(10.075)` → `1008`, not `1007`: the tie is resolved on the decimal
 * the caller wrote, not on its binary approximation.
 */
export function fromRupees(rupees: number): Paise {
  if (!Number.isFinite(rupees)) {
    throw new ValidationError('Rupee amount must be finite', { rupees });
  }
  return toPaise(roundHalfUp(scaleBy10(toDecimal(rupees), 2)), { rupees });
}

export function add(...amounts: readonly Paise[]): Paise {
  return toPaise(
    amounts.reduce<bigint>((sum, amount) => sum + BigInt(amount), 0n),
    { amounts },
  );
}

export function subtract(a: Paise, b: Paise): Paise {
  return toPaise(BigInt(a) - BigInt(b), { a, b });
}

/**
 * Multiply money by a quantity or rate. Exact until the final half-up rounding,
 * so a line total never loses a paisa to floating point:
 * `mul(paise(100), 10.075)` → `1008`.
 */
export function mul(amount: Paise, factor: number): Paise {
  if (!Number.isFinite(factor)) {
    throw new ValidationError('Multiplier must be finite', { factor });
  }
  return toPaise(
    roundHalfUp(multiplyDecimal({ units: BigInt(amount), scale: 0 }, toDecimal(factor))),
    {
      amount,
      factor,
    },
  );
}

/**
 * Basis points of an amount, e.g. `percentBp(paise(10_000), 500)` → 5% of ₹100.
 *
 * The division by 10 000 is folded into the scale rather than done in floating
 * point, so `bp / 10_000` never introduces a representation error of its own.
 */
export function percentBp(amount: Paise, bp: number): Paise {
  if (!Number.isFinite(bp)) {
    throw new ValidationError('Basis points must be finite', { bp });
  }
  const product = multiplyDecimal({ units: BigInt(amount), scale: 0 }, toDecimal(bp));
  return toPaise(roundHalfUp({ units: product.units, scale: product.scale + 4 }), { amount, bp });
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
