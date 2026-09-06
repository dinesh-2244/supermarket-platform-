import { describe, expect, it } from 'vitest';
import { cartToken, newId, orderNumber, trackingToken } from '../ids/index.js';

describe('platform/ids', () => {
  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, newId));
    expect(ids.size).toBe(500);
  });

  it('generates prefixed, unambiguous opaque tokens', () => {
    expect(cartToken()).toMatch(/^c_[0-9A-HJKMNP-TV-Z]{20}$/);
    expect(trackingToken()).toMatch(/^t_[0-9A-HJKMNP-TV-Z]{20}$/);
    expect(new Set(Array.from({ length: 500 }, trackingToken)).size).toBe(500);
  });

  it('builds a readable, store-prefixed order number', () => {
    const number = orderNumber('S1', new Date('2026-09-06T10:00:00Z'));
    expect(number).toMatch(/^S1-260906-[0-9A-HJKMNP-TV-Z]{5}$/);
  });
});
