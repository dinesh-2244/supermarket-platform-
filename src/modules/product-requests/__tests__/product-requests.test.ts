import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';
import {
  assertRequestTransition,
  PRODUCT_REQUEST_STATUSES,
  REQUEST_TRANSITIONS,
  validateSubmission,
} from '../domain/index';

describe('product-requests module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();
    expect(descriptor.name).toBe('product-requests');
    expect(descriptor.owns).toContain('ProductRequest');
    expect(descriptor.dependsOn).toEqual(['platform', 'stores']);
    expect(descriptor.emits).toEqual([]);
  });
});

describe('the triage table', () => {
  it('names every status exactly once', () => {
    expect([...PRODUCT_REQUEST_STATUSES].sort()).toEqual(
      ['DECLINED', 'FULFILLED', 'NEW', 'PLANNED', 'REVIEWED'].sort(),
    );
    expect(Object.keys(REQUEST_TRANSITIONS).sort()).toEqual([...PRODUCT_REQUEST_STATUSES].sort());
  });

  it('lets a new request go to any triage outcome', () => {
    for (const to of ['REVIEWED', 'PLANNED', 'DECLINED', 'FULFILLED'] as const) {
      expect(() => assertRequestTransition('NEW', to, 'reason')).not.toThrow();
    }
  });

  it('is terminal at FULFILLED', () => {
    for (const to of ['NEW', 'REVIEWED', 'PLANNED', 'DECLINED'] as const) {
      expect(() => assertRequestTransition('FULFILLED', to, 'x')).toThrow(/cannot/i);
    }
  });

  it('lets a declined request be reopened for review, and nothing else', () => {
    expect(() => assertRequestTransition('DECLINED', 'REVIEWED', null)).not.toThrow();
    expect(() => assertRequestTransition('DECLINED', 'PLANNED', null)).toThrow(/cannot/i);
    expect(() => assertRequestTransition('DECLINED', 'FULFILLED', null)).toThrow(/cannot/i);
  });

  it('never accepts the status it is already in', () => {
    for (const status of PRODUCT_REQUEST_STATUSES) {
      expect(() => assertRequestTransition(status, status, 'x')).toThrow(/already/i);
    }
  });

  it('refuses to decline without a reason', () => {
    expect(() => assertRequestTransition('NEW', 'DECLINED', null)).toThrow(/reason/i);
    expect(() => assertRequestTransition('REVIEWED', 'DECLINED', '   ')).toThrow(/reason/i);
    expect(() => assertRequestTransition('REVIEWED', 'DECLINED', 'Discontinued')).not.toThrow();
  });
});

describe('a submission', () => {
  it('needs a product name and nothing else', () => {
    expect(validateSubmission({ productName: '  Ragi flour ' })).toEqual({
      productName: 'Ragi flour',
      brand: null,
      packSize: null,
      note: null,
      customerName: null,
      customerPhone: null,
    });
  });

  it('refuses a blank product name', () => {
    expect(() => validateSubmission({ productName: '   ' })).toThrow(/product name/i);
  });

  it('trims the optional fields and blanks them to null', () => {
    expect(
      validateSubmission({
        productName: 'Ragi flour',
        brand: ' 24 Mantra ',
        packSize: '1 kg',
        note: '',
        customerName: ' Asha ',
        customerPhone: '+91 98765 43210',
      }),
    ).toEqual({
      productName: 'Ragi flour',
      brand: '24 Mantra',
      packSize: '1 kg',
      note: null,
      customerName: 'Asha',
      customerPhone: '9876543210',
    });
  });

  it('refuses a phone that is not an Indian mobile number', () => {
    expect(() => validateSubmission({ productName: 'x', customerPhone: '12345' })).toThrow(
      /mobile/i,
    );
  });

  it('caps the lengths, so a form cannot be used as free storage', () => {
    expect(() => validateSubmission({ productName: 'x'.repeat(121) })).toThrow(/too long/i);
    expect(() => validateSubmission({ productName: 'x', note: 'n'.repeat(501) })).toThrow(
      /too long/i,
    );
  });
});
