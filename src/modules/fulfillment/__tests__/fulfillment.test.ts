import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';

describe('fulfillment module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('fulfillment');
    // `pricing` joined in Phase 5: a substitute must be a product the store
    // lists, and that is `pricing`'s question to answer.
    expect(descriptor.dependsOn).toEqual([
      'platform',
      'orders',
      'inventory',
      'pricing',
      'notifications',
    ]);
    expect(descriptor.emits).toEqual(['order.picked', 'order.billed', 'order.delivered']);
  });
});
