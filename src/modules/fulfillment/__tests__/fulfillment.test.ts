import { describe, expect, it } from 'vitest';
import { moduleDescriptor } from '../index';

describe('fulfillment module', () => {
  it('declares the ownership and dependencies from architecture §4', () => {
    const descriptor = moduleDescriptor();

    expect(descriptor.name).toBe('fulfillment');
    // `pricing` and `identity` joined in Phase 5: a substitute must be a
    // product the store lists (`pricing`'s question), and a pick task may only
    // be handed to an active picker of the order's store (`identity`'s).
    expect(descriptor.dependsOn).toEqual([
      'platform',
      'orders',
      'inventory',
      'pricing',
      'identity',
      'notifications',
    ]);
    expect(descriptor.emits).toEqual(['order.picked', 'order.billed', 'order.delivered']);
  });
});
