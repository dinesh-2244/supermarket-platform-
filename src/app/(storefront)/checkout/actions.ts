'use server';

import { redirect } from 'next/navigation';
import { placeOrder } from '@/modules/checkout';
import { isAppError } from '@/modules/platform';
import { currentCartToken, currentStorefrontPrincipal, currentCustomer } from '@/storefront';

/**
 * The checkout server action (D4).
 *
 * Like the basket actions, it re-derives everything that decides money or store
 * from the server's own state: the cart token from its cookie, the signed-in
 * customer from their session. The form contributes what only a person can — who
 * to deliver to, where, when, and how they will pay — and every one of those is
 * re-checked inside `placeOrder`.
 *
 * The area comes from the form rather than the cookie on purpose: a shopper may
 * be delivering to an address other than the one they browsed from, and
 * `placeOrder` resolves it and refuses if it lands on a different shop than the
 * basket.
 */
function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

export async function placeOrderAction(
  _state: string | undefined,
  form: FormData,
): Promise<string> {
  let trackingToken: string;

  try {
    const cartToken = await currentCartToken();
    if (cartToken === null) return '!Your basket is empty.';

    const { principal } = await currentStorefrontPrincipal();
    const customer = await currentCustomer();

    const slotStart = new Date(text(form, 'slotStart'));

    const placed = await placeOrder(principal, {
      cartToken,
      contact: { name: text(form, 'name'), phone: text(form, 'phone') },
      addressInput: { areaId: text(form, 'areaId') },
      addressLines: { line1: text(form, 'line1'), line2: text(form, 'line2') },
      slotStart,
      paymentMethod: text(form, 'paymentMethod'),
      ...(customer === null ? {} : { customerSession: { customerId: customer.id } }),
    });

    trackingToken = placed.trackingToken;
  } catch (error) {
    if (isAppError(error)) return `!${error.message}`;
    return '!Something went wrong. Your basket has not been changed.';
  }

  // Outside the catch: `redirect` works by throwing, and catching it here would
  // turn a successful order into "something went wrong".
  redirect(`/order-placed/${trackingToken}`);
}
