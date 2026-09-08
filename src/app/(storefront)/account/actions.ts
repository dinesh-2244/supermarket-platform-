'use server';

import { redirect } from 'next/navigation';
import { adoptCart } from '@/modules/cart';
import {
  changePassword,
  createSessionForCustomer,
  destroyCustomerSession,
  signUp,
  updateProfile,
  verifyCustomerCredentials,
} from '@/modules/customers';
import { isAppError } from '@/modules/platform';
import {
  clearCustomerSessionCookie,
  currentCartToken,
  currentCustomerToken,
  currentStorefrontPrincipal,
  setCustomerSessionCookie,
} from '@/storefront';

/**
 * Customer account server actions (D6).
 *
 * Accounts are **optional** everywhere: nothing here is a prerequisite for
 * browsing, searching or building a basket. What signing in buys is a saved
 * address book and a basket that follows the person rather than the device.
 */
async function run(body: () => Promise<string>): Promise<string> {
  try {
    return await body();
  } catch (error) {
    if (isAppError(error)) return `!${error.message}`;
    return '!Something went wrong. Please try again.';
  }
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/** Passwords are never trimmed — leading and trailing spaces are characters. */
function secret(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value : '';
}

/**
 * Create an account, without signing anyone in.
 *
 * The neutral message is the enumeration defence, and it is the same whether
 * the address was new or already taken — see `customers.signUp`. Signing the
 * shopper in here would give the game away however the message was worded,
 * because "you are now signed in" and "you are not" are different outcomes.
 */
export async function signUpAction(_state: string | undefined, form: FormData): Promise<string> {
  return run(async () => {
    await signUp({
      name: text(form, 'name'),
      email: text(form, 'email'),
      phone: text(form, 'phone'),
      password: secret(form, 'password'),
    });
    return 'If that email and phone number were new, your account is ready — sign in below.';
  });
}

/**
 * Sign in, and take the basket on this device with you.
 *
 * `adoptCart` binds the current `cartToken` cart to the customer. The device's
 * basket wins over any other active one, which is marked abandoned rather than
 * merged — the shopper is looking at *this* basket, and folding in items chosen
 * elsewhere days ago produces one they did not assemble.
 */
export async function signInAction(_state: string | undefined, form: FormData): Promise<string> {
  const outcome = await run(async () => {
    const customer = await verifyCustomerCredentials(text(form, 'email'), secret(form, 'password'));
    // One undifferentiated failure for unknown email, wrong password and a
    // blocked account: the form must not double as an enumeration oracle.
    if (customer === null) return '!Those details do not match an account.';

    const session = await createSessionForCustomer(customer.id);
    await setCustomerSessionCookie(session.token, session.expiresAt);

    const cartToken = await currentCartToken();
    if (cartToken !== null) await adoptCart(cartToken, customer.id);
    return 'ok';
  });

  if (outcome !== 'ok') return outcome;
  redirect('/account');
}

export async function signOutAction(): Promise<void> {
  const token = await currentCustomerToken();
  if (token !== null) await destroyCustomerSession(token);
  await clearCustomerSessionCookie();
  redirect('/');
}

export async function updateProfileAction(
  _state: string | undefined,
  form: FormData,
): Promise<string> {
  return run(async () => {
    const { principal } = await currentStorefrontPrincipal();
    await updateProfile(principal, { name: text(form, 'name'), phone: text(form, 'phone') });
    return 'Your details are saved.';
  });
}

/**
 * Change a password, which ends every session — including this one.
 *
 * The cookie is cleared and the shopper signs in again, which is honest: the
 * usual reason to change a password is that somebody else might know the old
 * one, and leaving this browser signed in on a session the server has already
 * deleted would show them an account that no longer opens.
 */
export async function changePasswordAction(
  _state: string | undefined,
  form: FormData,
): Promise<string> {
  const outcome = await run(async () => {
    const { principal } = await currentStorefrontPrincipal();
    await changePassword(principal, {
      currentPassword: secret(form, 'currentPassword'),
      newPassword: secret(form, 'newPassword'),
    });
    await clearCustomerSessionCookie();
    return 'ok';
  });

  if (outcome !== 'ok') return outcome;
  redirect('/account/sign-in?changed=1');
}
