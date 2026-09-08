import { describe, expect, it } from 'vitest';
import {
  assertCustomerName,
  assertCustomerPassword,
  CUSTOMER_SESSION_MAX_AGE_SECONDS,
  descriptor,
  MIN_CUSTOMER_PASSWORD_LENGTH,
  normalizeCustomerEmail,
  normalizePhone,
} from '../domain/index';

describe('customers — module descriptor (§4)', () => {
  it('declares what it owns and may depend on', () => {
    expect(descriptor.name).toBe('customers');
    expect(descriptor.owns).toContain('CustomerSession');
    // A shopper's module must never reach into staff identity (ADR-0010).
    expect(descriptor.dependsOn).not.toContain('identity');
    expect(descriptor.emits).toEqual(['customer.registered']);
  });

  it('keeps a shopper signed in for longer than a working day', () => {
    // A shopper buys groceries every week or two; a staff session is a shift.
    expect(CUSTOMER_SESSION_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30);
  });
});

describe('customers — email', () => {
  it('normalises case and whitespace so one person is one account', () => {
    expect(normalizeCustomerEmail('  A.Person@Example.COM ')).toBe('a.person@example.com');
  });

  it('refuses something that is not an address', () => {
    for (const bad of ['', 'nope', 'a@b', 'a b@c.com', '@example.com', 'a@@b.com']) {
      expect(() => normalizeCustomerEmail(bad)).toThrow(/valid email/i);
    }
  });
});

describe('customers — phone', () => {
  it('keeps the ten digits people actually dial', () => {
    expect(normalizePhone('9876543210')).toBe('9876543210');
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('98765-43210')).toBe('9876543210');
    // The same person typing it three ways must not become three customers.
    expect(normalizePhone('(98765) 43210')).toBe('9876543210');
  });

  it('refuses numbers that are not Indian mobiles', () => {
    // Landline prefixes, wrong lengths and letters.
    for (const bad of ['1234567890', '5876543210', '98765', '98765432101', 'abcdefghij']) {
      expect(() => normalizePhone(bad)).toThrow(/10-digit/i);
    }
  });
});

describe('customers — password and name', () => {
  it('sets a lower bar than staff, deliberately', () => {
    // A staff password guards every store's pricing; this guards an address
    // book. A bar people will not meet pushes them to reuse one they have.
    expect(MIN_CUSTOMER_PASSWORD_LENGTH).toBe(8);
    expect(() => {
      assertCustomerPassword('12345678');
    }).not.toThrow();
    expect(() => {
      assertCustomerPassword('1234567');
    }).toThrow(/at least/i);
    expect(() => {
      assertCustomerPassword('        ');
    }).toThrow(/whitespace/i);
  });

  it('requires a name that is not blank, and not a paragraph', () => {
    expect(assertCustomerName('  Priya  ')).toBe('Priya');
    expect(() => assertCustomerName('   ')).toThrow(/required/i);
    expect(() => assertCustomerName('x'.repeat(200))).toThrow(/too long/i);
  });
});
