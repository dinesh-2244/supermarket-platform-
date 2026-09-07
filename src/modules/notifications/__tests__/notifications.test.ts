import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';

describe('notifications module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('notifications');
    expect(descriptor.dependsOn).toEqual(['platform']);
    expect(descriptor.emits).toEqual([]);
  });
});
