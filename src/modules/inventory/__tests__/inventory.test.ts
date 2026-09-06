import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index.js';

describe('inventory module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('inventory');
    expect(descriptor.dependsOn).toEqual(['platform', 'catalog', 'stores']);
    expect(descriptor.emits).toEqual(['stock.low', 'stock.changed']);
  });
});
