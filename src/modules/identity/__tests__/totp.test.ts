import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  counterFor,
  generateTotpSecret,
  otpauthUri,
  totpCodeAt,
  totpCodeFor,
  TOTP_PERIOD_SECONDS,
  verifyTotpCode,
} from '../domain/totp';

/**
 * RFC 6238 Appendix B, verbatim.
 *
 * This is the whole reason the algorithm is written here rather than pulled in:
 * "is our TOTP correct" is answerable against the specification's own vectors
 * instead of being taken on trust. The published secret is the ASCII string
 * "12345678901234567890"; Base32 that is the constant below. The RFC's table is
 * 8-digit, so these assert 8 digits — a 6-digit implementation that happened to
 * agree on the last six of a wrong number would still be caught.
 */
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

const RFC_VECTORS: readonly [seconds: number, code: string][] = [
  [59, '94287082'],
  [1_111_111_109, '07081804'],
  [1_111_111_111, '14050471'],
  [1_234_567_890, '89005924'],
  [2_000_000_000, '69279037'],
  [20_000_000_000, '65353130'],
];

describe('RFC 6238 test vectors (SHA-1)', () => {
  it('encodes the published secret to the expected Base32', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it.each(RFC_VECTORS)('at T=%i produces %s', async (seconds, expected) => {
    expect(await totpCodeFor(RFC_SECRET, counterFor(seconds * 1000), 8)).toBe(expected);
  });

  it('produces the six-digit truncation of the same numbers', async () => {
    for (const [seconds, eight] of RFC_VECTORS) {
      expect(await totpCodeAt(RFC_SECRET, seconds * 1000)).toBe(eight.slice(-6));
    }
  });
});

describe('base32', () => {
  it('round-trips arbitrary bytes', () => {
    for (const length of [1, 2, 3, 4, 5, 10, 20, 32]) {
      const bytes = crypto.getRandomValues(new Uint8Array(length));
      expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
    }
  });

  it('accepts what people actually paste', () => {
    // Authenticator apps display secrets in spaced groups, and some pad.
    const canonical = base32Decode('GEZDGNBVGY3TQOJQ');
    for (const variant of ['gezdgnbvgy3tqojq', 'GEZD GNBV GY3T QOJQ', 'GEZDGNBVGY3TQOJQ====']) {
      expect([...base32Decode(variant)]).toEqual([...canonical]);
    }
  });

  it('refuses a secret that is not Base32 at all', () => {
    // A silently-wrong secret presents as "my codes never work", which is a much
    // worse bug report than a rejection at the point of entry.
    for (const bad of ['', '   ', '!!!!', 'ABC1', 'ABC8', 'hello, world!', 'GEZD€GNBV']) {
      expect(() => base32Decode(bad)).toThrow(/valid authenticator secret/i);
    }
  });

  it('accepts letters that merely look like prose', () => {
    // `HELLOWORLD` is legitimate Base32 — every character is in A-Z. Worth
    // pinning so nobody later "fixes" the validator into rejecting real secrets
    // that happen to spell something.
    expect(() => base32Decode('hello world')).not.toThrow();
    expect(base32Decode('HELLOWORLD')).toHaveLength(6);
  });
});

describe('generateTotpSecret', () => {
  it('is 160 bits, which is what RFC 4226 requires for SHA-1', () => {
    expect(base32Decode(generateTotpSecret())).toHaveLength(20);
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(seen.size).toBe(50);
  });

  it('produces a secret its own code generator accepts', async () => {
    const secret = generateTotpSecret();
    const now = Date.UTC(2026, 8, 10, 12, 0, 0);
    expect(await verifyTotpCode(secret, await totpCodeAt(secret, now), now)).toBe(true);
  });
});

describe('verifyTotpCode', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const now = Date.UTC(2026, 8, 10, 12, 0, 30);
  const step = TOTP_PERIOD_SECONDS * 1000;

  it('accepts the current code', async () => {
    expect(await verifyTotpCode(secret, await totpCodeAt(secret, now), now)).toBe(true);
  });

  it('accepts one step either side, for clock skew and typing time', async () => {
    expect(await verifyTotpCode(secret, await totpCodeAt(secret, now - step), now)).toBe(true);
    expect(await verifyTotpCode(secret, await totpCodeAt(secret, now + step), now)).toBe(true);
  });

  it('refuses two steps away — the window is one, deliberately', async () => {
    expect(await verifyTotpCode(secret, await totpCodeAt(secret, now - 2 * step), now)).toBe(false);
    expect(await verifyTotpCode(secret, await totpCodeAt(secret, now + 2 * step), now)).toBe(false);
  });

  it('refuses another secret’s code for the same instant', async () => {
    const other = generateTotpSecret();
    expect(await verifyTotpCode(secret, await totpCodeAt(other, now), now)).toBe(false);
  });

  it('tolerates a code typed with spaces', async () => {
    const code = await totpCodeAt(secret, now);
    expect(await verifyTotpCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
  });

  it('refuses anything that is not six digits, without throwing', async () => {
    for (const bad of ['', '123', '1234567', 'abcdef', '12345a', '  ', '-12345']) {
      await expect(verifyTotpCode(secret, bad, now)).resolves.toBe(false);
    }
  });

  it('refuses a code that has expired by the time it is used', async () => {
    // The property the window exists to bound: a code shoulder-surfed a couple
    // of minutes ago is no longer worth anything.
    const stale = await totpCodeAt(secret, now);
    expect(await verifyTotpCode(secret, stale, now + 5 * step)).toBe(false);
  });
});

describe('otpauthUri', () => {
  it('is a scannable otpauth:// URI naming the issuer twice', async () => {
    const uri = otpauthUri({
      secret: 'GEZDGNBVGY3TQOJQ',
      account: 'manager.s1@munderfresh.local',
      issuer: 'Munder Fresh',
    });

    // Once in the label, so two enrolled environments are distinguishable in the
    // app's list; once as a parameter, which is what the app actually reads.
    expect(uri).toContain('otpauth://totp/Munder%20Fresh%3Amanager.s1%40munderfresh.local');
    const params = new URL(uri).searchParams;
    expect(params.get('secret')).toBe('GEZDGNBVGY3TQOJQ');
    expect(params.get('issuer')).toBe('Munder Fresh');
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
    await Promise.resolve();
  });
});
