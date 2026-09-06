import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';

describe('pricing module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('pricing');
    expect(descriptor.dependsOn).toEqual(['platform', 'catalog', 'stores']);
    expect(descriptor.emits).toEqual(['price.changed']);
  });
});
