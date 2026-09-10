/**
 * The provider Phase 4 ships: it logs and delivers nothing.
 *
 * There is no SMS or email vendor yet (ADR-0007 — the choice is
 * capability-dependent and is not being made here), and a stub that pretended
 * to send would be worse than one that says it did not. What this buys now is
 * that the *seam* is exercised on every order rather than being written for the
 * first time on the day a vendor is chosen.
 */
import { childLogger } from '../../platform/index';
import type { NotificationProvider, OutboundMessage } from '../domain/index';

export const noopProvider: NotificationProvider = {
  name: 'noop',
  async send(message: OutboundMessage): Promise<void> {
    childLogger('notifications').info(
      {
        provider: 'noop',
        channel: message.channel,
        template: message.template,
        // The recipient is deliberately **not** logged. A phone number in an
        // application log is a phone number in every log sink downstream.
        orderNumber: message.data.orderNumber,
        delivered: false,
      },
      'Confirmation not delivered — no notification vendor is configured',
    );
    return Promise.resolve();
  },
};
