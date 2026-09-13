'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { rebuildForStore } from '@/modules/cart';
import { isAppError } from '@/modules/platform';
import { submitProductRequest } from '@/modules/product-requests';
import { captureServiceabilityRequest, getStore, resolveServiceability } from '@/modules/stores';
import {
  clearCartMoveNotice,
  clearStoreContext,
  currentCartToken,
  currentStorefrontPrincipal,
  setCartMoveNotice,
  STORE_CONTEXT_COOKIE,
  STORE_CONTEXT_MAX_AGE_SECONDS,
  storefrontPrincipal,
} from '@/storefront';

/**
 * Server actions for the storefront shell.
 *
 * Every export in a `'use server'` file must be an async server action, so
 * anything that is *not* one — a validator, a path allow-list — lives elsewhere
 * (the same rule that moved `safeNextPath` out of the admin actions file).
 */

/** `!`-prefixed means the action failed; the shared `Notice` renders it as an error. */
async function run(body: () => Promise<string>): Promise<string> {
  try {
    return await body();
  } catch (error) {
    // Domain errors carry a message written for a person; anything else does
    // not, and its text must not reach the page.
    if (isAppError(error)) return `!${error.message}`;
    return '!Something went wrong. Please try again.';
  }
}

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Bind the visitor to a delivery area.
 *
 * The cookie is written **only after** `resolveServiceability` says the area is
 * really served, so an unservable area can never become a context; and only the
 * `areaId` is stored, because everything else is re-derived per request (see
 * `src/storefront.ts`). `HttpOnly` because no client script has any business
 * reading or setting which shop you are buying from.
 */
export async function chooseAreaAction(
  _state: string | undefined,
  form: FormData,
): Promise<string> {
  const areaId = text(form, 'areaId');
  const outcome = await run(async () => {
    if (areaId === '') return '!Choose a delivery area first.';

    const result = await resolveServiceability({ areaId });
    if (!result.servable) {
      // The *previous* context has to go too. Leaving it meant the redirect to
      // /unserviceable was cosmetic: the shopper's cookie still named the old
      // area, so /cart opened the old shop's basket and add/update kept working
      // against a store they had just been told does not serve them (R5).
      await clearStoreContext();
      await clearCartMoveNotice();
      return `!unserviceable:${result.reason}`;
    }

    const jar = await cookies();
    jar.set(STORE_CONTEXT_COOKIE, areaId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: STORE_CONTEXT_MAX_AGE_SECONDS,
      secure: process.env.NODE_ENV === 'production',
    });

    // The basket follows the shopper (D5). `rebuildForStore` is a no-op when the
    // new area is served by the same shop, and otherwise re-prices what the new
    // shop sells and drops what it does not — as one transaction, so the basket
    // is never half-moved between two stores.
    const cartToken = await currentCartToken();
    if (cartToken === null) {
      await clearCartMoveNotice();
    } else {
      const context = { areaId, serviceability: result };
      const principal = storefrontPrincipal(context);
      const outcome = await rebuildForStore(principal, cartToken, result.storeId);

      if (outcome.carried.length > 0 || outcome.dropped.length > 0) {
        const store = await getStore(principal, result.storeId);
        await setCartMoveNotice({
          storeName: store.name,
          carried: outcome.carried,
          dropped: outcome.dropped,
        });
      } else {
        // Same shop, or an empty basket: nothing moved, so a leftover notice
        // from an earlier switch must not be shown again.
        await clearCartMoveNotice();
      }
    }
    return 'ok';
  });

  // `redirect` throws, so it must happen outside the try/catch that would
  // otherwise swallow it as a failure.
  if (outcome.startsWith('!unserviceable:')) {
    redirect(`/unserviceable?reason=${outcome.slice('!unserviceable:'.length)}`);
  }
  if (outcome !== 'ok') return outcome;
  redirect('/');
}

/**
 * Forget the current area and go back to the picker.
 *
 * The cart is deliberately *not* touched: a shopper who is between addresses
 * still has their basket when they choose again (D5).
 */
export async function clearAreaAction(): Promise<void> {
  await clearStoreContext();
  redirect('/store/select');
}

/**
 * Record an out-of-zone visitor as a demand signal (§15).
 *
 * This is the only thing the storefront writes before a cart exists, and it
 * writes no catalogue, stock or order data — just "somebody in this pincode
 * wanted us". The response is the same whether or not the row was novel.
 */
export async function captureInterestAction(
  _state: string | undefined,
  form: FormData,
): Promise<string> {
  return run(async () => {
    const pincode = text(form, 'pincode');
    const locality = text(form, 'locality');
    if (pincode === '' && locality === '') {
      return '!Tell us your pincode or locality so we know where to open next.';
    }

    await captureServiceabilityRequest({
      ...(locality === '' ? {} : { locality }),
      ...(pincode === '' ? {} : { pincode }),
    });
    return 'Thank you — we have noted it. We will get to your area as soon as we can.';
  });
}

/**
 * Submit a customer product request (Phase 5.5).
 */
export async function requestProductAction(
  _state: string | undefined,
  form: FormData,
): Promise<string> {
  return run(async () => {
    const { principal } = await currentStorefrontPrincipal();
    const productName = text(form, 'productName');
    const brand = text(form, 'brand');
    const packSize = text(form, 'packSize');
    const note = text(form, 'note');
    const customerName = text(form, 'customerName');
    const customerPhone = text(form, 'customerPhone');

    await submitProductRequest(principal, {
      productName,
      brand: brand === '' ? null : brand,
      packSize: packSize === '' ? null : packSize,
      note: note === '' ? null : note,
      customerName: customerName === '' ? null : customerName,
      customerPhone: customerPhone === '' ? null : customerPhone,
    });

    return 'ok';
  });
}
