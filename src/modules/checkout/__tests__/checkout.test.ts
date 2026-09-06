import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';

describe('checkout module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('checkout');
    expect(descriptor.dependsOn).toEqual([
      'platform',
      'cart',
      'orders',
      'inventory',
      'stores',
      'customers',
    ]);
    expect(descriptor.emits).toEqual(['order.placed']);
  });
});
