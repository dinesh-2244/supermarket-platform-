import { ValidationError } from '@/modules/platform';

/**
 * Strict decimal rupee parser for pricing fields.
 *
 * Rejects scientific notation ('1e2'), hex ('0x10'), more than 2 decimal places
 * ('10.999', '0.005'), negative amounts, and out-of-range values before doing
 * any number coercion.
 */
export const RUPEE_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
export const MAX_PAISE = 2_147_483_647; // Max signed 32-bit int in Postgres (INTEGER column)

export function parseRupeesToPaise(raw: string, key: string, label = key): number {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new ValidationError(`${label} is required`, { field: key });
  }
  if (!RUPEE_AMOUNT_PATTERN.test(trimmed)) {
    throw new ValidationError(
      `${label} must be a valid non-negative rupee amount with at most 2 decimal places, not "${raw}"`,
      { field: key, value: raw },
    );
  }

  // Parse exact whole and fractional digits to paise without floating-point precision loss
  const [wholeStr = '0', fracStr = ''] = trimmed.split('.');
  const fracPadded = fracStr.padEnd(2, '0');
  const paiseBig = BigInt(wholeStr) * 100n + BigInt(fracPadded);

  if (paiseBig > BigInt(MAX_PAISE)) {
    throw new ValidationError(`${label} is out of range`, { field: key, value: raw });
  }

  return Number(paiseBig);
}
