import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';

describe('admin module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('admin');
    expect(descriptor.dependsOn).toEqual([
      'platform',
      'stores',
      'catalog',
      'pricing',
      'inventory',
      'identity',
      'customers',
      'orders',
      'fulfillment',
    ]);
    expect(descriptor.emits).toEqual([]);
  });
});
