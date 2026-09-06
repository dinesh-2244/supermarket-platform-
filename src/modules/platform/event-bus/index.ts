import { childLogger } from '../logger/index.js';

/**
 * Domain events (§4). Synchronous and in-process: a handler runs on the emitting
 * call stack, *after* its transaction has committed. Payloads carry ids, never
 * Prisma models, so a handler cannot reach into another module's storage.
 */
export interface DomainEvents {
  'product.updated': { productId: string };
  'price.changed': { storeProductId: string; oldPricePaise: number; newPricePaise: number };
  'stock.changed': { storeId: string; productId: string; balanceAfter: number };
  'stock.low': { storeId: string; productId: string; balanceAfter: number };
  'user.created': { userId: string };
  'user.disabled': { userId: string };
  'customer.registered': { customerId: string };
  'order.placed': { orderId: string; storeId: string };
  'order.picked': { orderId: string };
  'order.billed': { orderId: string; priceVarianceFlagged: boolean };
  'order.delivered': { orderId: string };
  'order.cancelled_by_store': { orderId: string; reason: string };
}

export type DomainEventName = keyof DomainEvents;
export type EventHandler<N extends DomainEventName> = (payload: DomainEvents[N]) => void;

/**
 * Handlers are stored behind a bivariant-safe signature; the per-event type is
 * restored at the `emit` call site, which is the only place it matters.
 */
type StoredHandler = (payload: never) => void;

const handlers = new Map<DomainEventName, Set<StoredHandler>>();

/** Subscribe to an event. Returns an unsubscribe function. */
export function on<N extends DomainEventName>(name: N, handler: EventHandler<N>): () => void {
  let set = handlers.get(name);
  if (!set) {
    set = new Set<StoredHandler>();
    handlers.set(name, set);
  }
  const registered = set;
  registered.add(handler);
  return () => {
    registered.delete(handler);
  };
}

/**
 * Publish an event to every subscriber.
 *
 * A throwing handler must not roll back or mask the use-case that already
 * succeeded, so failures are logged and the remaining handlers still run.
 */
export function emit<N extends DomainEventName>(name: N, payload: DomainEvents[N]): void {
  const set = handlers.get(name);
  if (!set || set.size === 0) return;

  for (const handler of set) {
    try {
      (handler as EventHandler<N>)(payload);
    } catch (error) {
      childLogger('event-bus').error({ err: error, event: name }, 'Event handler failed');
    }
  }
}

/** Boot-time registration point — module handlers are wired here (§4). */
export function registerEventHandlers(): void {
  // Phase 1 has no cross-module reactions yet. Phase 2 modules register here.
}

/** Test seam: drop every subscription. */
export function clearEventHandlersForTests(): void {
  handlers.clear();
}
