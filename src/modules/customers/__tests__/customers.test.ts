import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index.js';

describe('customers module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('customers');
    expect(descriptor.dependsOn).toEqual(['platform', 'notifications']);
    expect(descriptor.emits).toEqual(['customer.registered']);
  });
});
