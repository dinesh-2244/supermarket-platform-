/**
 * TOTP (RFC 6238) for optional staff two-factor authentication.
 *
 * Implemented here rather than pulled in as a dependency. The algorithm is
 * HMAC-SHA1 over a time counter and a Base32 alphabet — about eighty lines —
 * and RFC 6238 ships official test vectors, so "is this correct" is a question
 * with an answer rather than a matter of trust. A new production dependency in
 * the authentication path is a much larger thing to justify than this is to
 * write, and it would need Michael's approval.
 *
 * Uses **Web Crypto** (`globalThis.crypto`), not `node:crypto`, for the same
 * reason `platform/ids` does: `src/middleware.ts` makes Next compile parts of
 * this tree for the edge runtime, where a `node:` import fails the production
 * build outright. One API that works in both places beats two code paths.
 */
import { ValidationError } from '../../platform/index';

/** RFC 4648 Base32, which is what every authenticator app reads. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 6238's default, and what every authenticator app assumes. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

/**
 * How many steps either side of "now" are accepted.
 *
 * One step — thirty seconds — absorbs the clock skew between a phone and this
 * server and the seconds a person spends typing. Wider would meaningfully
 * lengthen the window in which a shoulder-surfed code still works.
 */
export const TOTP_WINDOW_STEPS = 1;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Decode a Base32 secret.
 *
 * Tolerant of what people actually paste: lower case, padding, and the spaces
 * authenticator apps put in for readability. Anything else is a typo, and a
 * silently wrong secret would present as "my codes never work".
 */
export function base32Decode(secret: string): Uint8Array {
  const cleaned = secret.replace(/[\s-]/g, '').replace(/=+$/, '').toUpperCase();
  if (cleaned === '' || /[^A-Z2-7]/.test(cleaned)) {
    throw new ValidationError('That is not a valid authenticator secret', {});
  }

  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of cleaned) {
    value = (value << 5) | ALPHABET.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/**
 * A fresh secret: 160 bits, the size RFC 4226 §4 requires for HMAC-SHA1.
 *
 * From the CSPRNG, never from a timestamp or a counter — a guessable secret is
 * a second factor that only looks like one.
 */
export function generateTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** The counter for an instant: elapsed 30-second steps since the Unix epoch. */
export function counterFor(atMs: number, period = TOTP_PERIOD_SECONDS): number {
  return Math.floor(atMs / 1000 / period);
}

async function hmacSha1(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey(
    'raw',
    key as unknown as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', imported, message as unknown as ArrayBuffer),
  );
}

/** The RFC 4226 code for one counter value. Zero-padded to `digits`. */
export async function totpCodeFor(
  secret: string,
  counter: number,
  digits = TOTP_DIGITS,
): Promise<string> {
  const message = new Uint8Array(8);
  // Big-endian, and written through a float divide because a counter beyond
  // 2^32 (the year 6053) would otherwise be silently truncated by `<<`.
  let remaining = counter;
  for (let i = 7; i >= 0; i -= 1) {
    message[i] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }

  const digest = await hmacSha1(base32Decode(secret), message);
  const offset = (digest[19] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The code for an instant — what the person's phone is showing right now. */
export function totpCodeAt(secret: string, atMs: number, digits = TOTP_DIGITS): Promise<string> {
  return totpCodeFor(secret, counterFor(atMs), digits);
}

/**
 * Value-independent comparison of two strings **of the same length**.
 *
 * N1 — this used to claim to be length-independent, which it is not: the early
 * return on a length mismatch is a branch an attacker could time. Nothing here
 * can reach it — `verifyTotpCode` rejects anything that is not exactly six
 * digits before it calls this, and the codes it compares against are six digits
 * by construction — so the guarantee that matters is the one now written down:
 * for equal-length inputs the time taken says nothing about *where* they
 * differ, or whether they differ at all. The length check stays as a
 * correctness guard for a future caller; the comment no longer over-promises.
 */
function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Is this the code that secret is showing, within the accepted window?
 *
 * Every candidate step is compared even after a match, and the comparison is
 * constant-time: the time this takes must not say which step matched, or
 * whether the first character was right.
 */
export async function verifyTotpCode(
  secret: string,
  code: string,
  atMs: number,
  windowSteps = TOTP_WINDOW_STEPS,
): Promise<boolean> {
  const candidate = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(candidate)) return false;

  const centre = counterFor(atMs);
  let matched = false;
  for (let step = -windowSteps; step <= windowSteps; step += 1) {
    const expected = await totpCodeFor(secret, centre + step);
    if (constantTimeEquals(expected, candidate)) matched = true;
  }
  return matched;
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The label carries the issuer as well as the account so a person with two
 * environments enrolled does not have to guess which "admin@…" is which.
 */
export function otpauthUri(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
