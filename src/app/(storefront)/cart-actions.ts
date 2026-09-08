'use server';

import { revalidatePath } from 'next/cache';
import { addItem, ensureCart, removeItem, setQuantity } from '@/modules/cart';
import { isAppError } from '@/modules/platform';
import {
  clearCartMoveNotice,
  currentCartToken,
  currentStoreContext,
  setCartTokenCookie,
  storefrontPrincipal,
} from '@/storefront';
import { changeSummary, withSummary } from './cart-notices';

/**
 * Basket server actions (D4).
 *
 * Each one re-derives the store context from the cookie rather than trusting a
 * `storeId` in the form: the form is the client's to write, and which shop a
 * basket belongs to is not the client's to decide. The product id *is* taken
 * from the form — it has to be — which is why the service checks that the store
 * lists it before anything is written.
 */
async function run(body: () => Promise<string>): Promise<string> {
  try {
    // Any deliberate action on the basket supersedes the "your basket moved"
    // notice from an earlier area change, so it goes here rather than being
    // consumed by the page — which Next.js does not allow.
    await clearCartMoveNotice();
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

/**
 * A quantity from a form is a string a person typed.
 *
 * The whole field must be an integer: `Number.parseInt` would read "2.9" as 2
 * and "3kg" as 3, turning a typo into a silent, different order. The same rule
 * the back office learned in R8.
 */
function quantity(form: FormData, key: string): number {
  const raw = text(form, key);
  if (!/^\d+$/.test(raw)) return Number.NaN;
  return Number.parseInt(raw, 10);
}

export async function addToCartAction(_state: string | undefined, form: FormData): Promise<string> {
  return run(async () => {
    const context = await currentStoreContext();
    if (context === null) return '!Choose your delivery area first.';

    const productId = text(form, 'productId');
    const qty = quantity(form, 'qty');
    if (productId === '') return '!Nothing to add.';
    if (!Number.isFinite(qty)) return '!Enter a whole number of items.';

    const storeId = context.serviceability.storeId;
    const existing = await currentCartToken();
    const { cart, created } = await ensureCart(storeId, existing);
    if (created) await setCartTokenCookie(cart.cartToken);

    const view = await addItem(storefrontPrincipal(context), {
      cartToken: cart.cartToken,
      storeId,
      productId,
      qty,
    });

    revalidatePath('/cart');
    const line = view.lines.find((row) => row.productId === productId);
    const lead =
      line === undefined
        ? 'Added to your basket.'
        : `${line.name} — ${String(line.qty)} in your basket.`;
    // Whatever this add's revalidation found goes out with it: this is the only
    // response that has it, because the page will revalidate against an
    // already-updated snapshot and find nothing left to say (R1).
    return withSummary(lead, changeSummary(view));
  });
}

export async function setCartQuantityAction(
  _state: string | undefined,
  form: FormData,
): Promise<string> {
  return run(async () => {
    const context = await currentStoreContext();
    const cartToken = await currentCartToken();
    if (context === null || cartToken === null) return '!Your basket is empty.';

    const productId = text(form, 'productId');
    const qty = quantity(form, 'qty');
    if (!Number.isFinite(qty)) return '!Enter a whole number of items.';

    const view = await setQuantity(storefrontPrincipal(context), { cartToken, productId, qty });
    revalidatePath('/cart');
    return withSummary('Basket updated.', changeSummary(view));
  });
}

export async function removeFromCartAction(
  _state: string | undefined,
  form: FormData,
): Promise<string> {
  return run(async () => {
    const context = await currentStoreContext();
    const cartToken = await currentCartToken();
    if (context === null || cartToken === null) return '!Your basket is empty.';

    const view = await removeItem(storefrontPrincipal(context), {
      cartToken,
      productId: text(form, 'productId'),
    });
    revalidatePath('/cart');
    // A removal revalidates the whole basket, so it can be the thing that
    // discovers a price move or a delisting on a line the shopper is keeping.
    return withSummary('Removed from your basket.', changeSummary(view));
  });
}
