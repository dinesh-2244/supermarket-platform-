import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index.js';

describe('orders module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('orders');
    expect(descriptor.dependsOn).toEqual(['platform', 'inventory']);
    expect(descriptor.emits).toEqual(['order.<transition>']);
  });
});
