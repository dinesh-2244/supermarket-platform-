import { randomBytes, randomUUID } from 'node:crypto';

/** Primary-key id. UUID v4 — matches the Prisma `@default(uuid())` columns. */
export function newId(): string {
  return randomUUID();
}

// Crockford-ish base32 without look-alike characters, so a token can be read
// out over the phone without ambiguity.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomToken(byteLength: number): string {
  const bytes = randomBytes(byteLength);
  let out = '';
  for (const byte of bytes) {
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/** Opaque cart cookie value — unguessable, no login required (§10). */
export function cartToken(): string {
  return `c_${randomToken(20)}`;
}

/** Opaque guest order-status token used by `/order-status/[token]` (§11). */
export function trackingToken(): string {
  return `t_${randomToken(20)}`;
}

/**
 * Opaque staff session id. 256 bits of CSPRNG output, hex-encoded — the cookie
 * carries only this, never a role or a store, so there is nothing in it a client
 * could usefully tamper with and nothing to verify beyond "does this row exist".
 */
export function sessionToken(): string {
  return randomBytes(32).toString('hex');
}

/** Per-request correlation id for the logger. */
export function requestId(): string {
  return randomUUID();
}

/**
 * Human-facing order number, e.g. `S1-260906-4KQ7X`. Uniqueness is still
 * guaranteed by the unique index; the random tail keeps it unguessable.
 */
export function orderNumber(storeCode: string, now: Date = new Date()): string {
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${storeCode}-${yy}${mm}${dd}-${randomToken(5)}`;
}
