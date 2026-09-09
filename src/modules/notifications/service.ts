/**
 * Use-cases for `notifications`.
 *
 * This module reacts; it never decides. It subscribes to `order.placed` and asks
 * the configured provider to send a confirmation. Phase 4's provider is a no-op
 * that logs, so nothing is actually delivered — which is the honest state of
 * affairs until a vendor is chosen (ADR-0007).
 */
import { childLogger, on, type DomainEvents } from '../platform/index';
import { descriptor, orderConfirmationMessage, type ModuleDescriptor } from './domain/index';
import type { NotificationProvider } from './domain/index';
import { noopProvider } from './providers/noop';

/** What this module owns and is allowed to depend on (§4). */
export function moduleDescriptor(): ModuleDescriptor {
  return descriptor;
}

let provider: NotificationProvider = noopProvider;

/** Which provider is in use. Swapped by a future vendor adapter, and by tests. */
export function currentProvider(): NotificationProvider {
  return provider;
}

export function setProviderForTests(next: NotificationProvider): void {
  provider = next;
}

export function resetProvider(): void {
  provider = noopProvider;
}

/**
 * What the module needs from an order to write its confirmation.
 *
 * `notifications` may not read `Order` — that is `orders`' table (§4, R7) — so
 * the caller supplies it. Keeping the dependency pointing this way is also why
 * this module can stay at `dependsOn: ['platform']`.
 */
export interface OrderConfirmationInput {
  readonly phone: string;
  readonly orderNumber: string;
  readonly trackingToken: string;
  readonly estimatedTotalPaise: number;
  readonly slotLabel: string;
}

/**
 * Send (or, today, decline to send) one order confirmation.
 *
 * Never throws. A notification is a consequence of something that has already
 * committed, and an order that succeeded must not be reported as failed because
 * a message could not go out.
 */
export async function sendOrderConfirmation(input: OrderConfirmationInput): Promise<void> {
  try {
    await provider.send(
      orderConfirmationMessage({
        channel: 'sms',
        to: input.phone,
        orderNumber: input.orderNumber,
        trackingToken: input.trackingToken,
        estimatedTotalPaise: input.estimatedTotalPaise,
        slotLabel: input.slotLabel,
      }),
    );
  } catch (error) {
    childLogger('notifications').error(
      { err: error, orderNumber: input.orderNumber },
      'Could not send the order confirmation',
    );
  }
}

/**
 * Subscribe to `order.placed`. Called once at boot from `instrumentation.ts`,
 * which is the only place that may wire modules to each other (§4).
 *
 * The handler takes the confirmation details from a lookup rather than the event
 * payload: the bus carries ids, not customer data, and a phone number on the
 * event bus is a phone number in every subscriber's reach.
 */
export function registerOrderNotifications(
  lookup: (orderId: string) => Promise<OrderConfirmationInput | null>,
): () => void {
  return on('order.placed', (payload: DomainEvents['order.placed']) => {
    void (async () => {
      try {
        const details = await lookup(payload.orderId);
        if (details === null) return;
        await sendOrderConfirmation(details);
      } catch (error) {
        childLogger('notifications').error(
          { err: error, orderId: payload.orderId },
          'Could not prepare the order confirmation',
        );
      }
    })();
  });
}
