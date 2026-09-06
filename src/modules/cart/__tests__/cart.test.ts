import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';

describe('cart module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('cart');
    expect(descriptor.dependsOn).toEqual(['platform', 'catalog', 'pricing', 'inventory', 'stores']);
    expect(descriptor.emits).toEqual([]);
  });
});
