import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';

describe('fulfillment module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('fulfillment');
    expect(descriptor.dependsOn).toEqual(['platform', 'orders', 'inventory', 'notifications']);
    expect(descriptor.emits).toEqual(['order.picked', 'order.billed', 'order.delivered']);
  });
});
