/**
 * Pure domain logic for `notifications` — no I/O, no Prisma, no framework types.
 */

/** Static description of what this module owns and may depend on (§4). */
export interface ModuleDescriptor {
  readonly name: string;
  readonly owns: string;
  readonly dependsOn: readonly string[];
  readonly emits: readonly string[];
}

export const descriptor: ModuleDescriptor = {
  name: 'notifications',
  owns: 'provider interface plus SMS/email/no-op implementations, outbound log',
  dependsOn: ['platform'],
  emits: [],
};

export type NotificationChannel = 'sms' | 'email';

/** One message the platform would like sent, in vendor-neutral terms. */
export interface OutboundMessage {
  readonly channel: NotificationChannel;
  /** Phone number or email address, as the customer gave it. */
  readonly to: string;
  readonly template: 'order-confirmation';
  /** Everything the template needs. No PII beyond what the channel already is. */
  readonly data: Readonly<Record<string, string>>;
}

/**
 * The seam a real SMS or email vendor slots behind (§4, ADR-0007's posture on
 * capability-dependent integrations).
 *
 * `send` returns nothing and throws nothing a caller is expected to handle: a
 * notification is a side-effect of something that has already happened, and an
 * order must never fail because a message could not go out.
 */
export interface NotificationProvider {
  readonly name: string;
  send(message: OutboundMessage): Promise<void>;
}

/**
 * What the order-confirmation message would say.
 *
 * Pure, so the wording is testable without a provider, and so the *shape* of
 * what leaves the building is reviewable in one place. Note what is not here:
 * no line items, no address, no customer id — a confirmation is a receipt
 * pointer, not a copy of the order.
 */
export function orderConfirmationMessage(input: {
  channel: NotificationChannel;
  to: string;
  orderNumber: string;
  trackingToken: string;
  estimatedTotalPaise: number;
  slotLabel: string;
}): OutboundMessage {
  return {
    channel: input.channel,
    to: input.to,
    template: 'order-confirmation',
    data: {
      orderNumber: input.orderNumber,
      trackingPath: `/order-status/${input.trackingToken}`,
      estimatedTotal: `₹${(input.estimatedTotalPaise / 100).toFixed(2)}`,
      slot: input.slotLabel,
    },
  };
}
