import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearEventHandlersForTests, emit, on } from '../event-bus/index.js';

afterEach(() => {
  clearEventHandlersForTests();
});

describe('platform/event-bus', () => {
  it('delivers a payload to every subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    on('order.placed', first);
    on('order.placed', second);

    emit('order.placed', { orderId: 'o1', storeId: 's1' });

    expect(first).toHaveBeenCalledWith({ orderId: 'o1', storeId: 's1' });
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not deliver to other events', () => {
    const handler = vi.fn();
    on('order.picked', handler);

    emit('order.placed', { orderId: 'o1', storeId: 's1' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribes', () => {
    const handler = vi.fn();
    const off = on('order.delivered', handler);
    off();

    emit('order.delivered', { orderId: 'o1' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('keeps running handlers after one throws', () => {
    const failing = vi.fn(() => {
      throw new Error('handler blew up');
    });
    const after = vi.fn();
    on('stock.changed', failing);
    on('stock.changed', after);

    expect(() =>
      emit('stock.changed', { storeId: 's1', productId: 'p1', balanceAfter: 4 }),
    ).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when nothing is subscribed', () => {
    expect(() => emit('user.created', { userId: 'u1' })).not.toThrow();
  });
});
