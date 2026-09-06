import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';

describe('catalog module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('catalog');
    expect(descriptor.dependsOn).toEqual(['platform']);
    expect(descriptor.emits).toEqual(['product.updated']);
  });
});
