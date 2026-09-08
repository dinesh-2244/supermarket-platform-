import { cookies } from 'next/headers';
import { type Principal } from '@/modules/platform';
import { resolveServiceability, type ServiceableResult } from '@/modules/stores';

/**
 * Store context for the customer-facing storefront (arch §9, §15) — the
 * shopper-side counterpart of `src/auth.ts`.
 *
 * ## What the cookie carries, and why it is only that
 *
 * `storeContext` holds the **`areaId` the visitor picked**, and nothing else.
 * Not the store, not the delivery fee, not the minimum order. Every one of those
 * is re-derived from `stores.resolveServiceability` on each request, so:
 *
 * - a cookie a client edits can only ever name a *different area*, which
 *   resolves to whatever that area really resolves to — there is no store id to
 *   forge and no fee to rewrite;
 * - closing a store, deactivating an area or moving it to another zone takes
 *   effect on the visitor's next page load rather than whenever their cookie
 *   happens to expire.
 *
 * That is the same reasoning as the staff session cookie carrying only an opaque
 * id: the cookie is a *pointer*, never a claim.
 */
export const STORE_CONTEXT_COOKIE = 'storeContext';

/** A month. Long enough that a returning shopper is not re-asked constantly. */
export const STORE_CONTEXT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/** The resolved context for this request: which area, and the store it serves. */
export interface StoreContext {
  readonly areaId: string;
  readonly serviceability: ServiceableResult;
}

/**
 * Resolve the current visitor's store context, or `null`.
 *
 * `null` means "show the locality picker": either no cookie, or one naming an
 * area that no longer resolves — a deactivated area, a closed store, a zone that
 * moved. The caller must not fall back to a default store; guessing which shop a
 * person buys from is worse than asking.
 */
export async function currentStoreContext(): Promise<StoreContext | null> {
  const jar = await cookies();
  const areaId = jar.get(STORE_CONTEXT_COOKIE)?.value ?? '';
  if (areaId === '') return null;

  const serviceability = await resolveServiceability({ areaId });
  if (!serviceability.servable) return null;

  return { areaId, serviceability };
}

/**
 * The authorization principal for a storefront request.
 *
 * Always a `customer` principal, never `system` and never a staff `user`:
 * a guest is a customer with no `customerId`, which is what makes "browse and
 * cart without an account" a property of the type rather than of a code path.
 * `storeId` comes from the freshly resolved context, so a shopper's read scope
 * follows the area they actually picked.
 *
 * `customerId` is filled in by the customer session (D6); until then every
 * storefront request is a guest.
 */
export function storefrontPrincipal(
  context: StoreContext | null,
  customerId: string | null = null,
): Principal {
  return {
    kind: 'customer',
    customerId,
    storeId: context?.serviceability.storeId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Cart token
// ---------------------------------------------------------------------------

/**
 * The opaque basket cookie (arch §10).
 *
 * `HttpOnly` so no script can read or forge it, `SameSite=Lax` so another site
 * cannot drive a basket on the shopper's behalf, and long-lived because a
 * grocery basket is often assembled over days. Like `storeContext`, it carries
 * an id and nothing else: the cart's store, its lines and their prices all live
 * in the database, so there is nothing in the cookie worth tampering with.
 */
export const CART_TOKEN_COOKIE = 'cartToken';

/** A year. A basket abandoned longer than that is not one anyone wants back. */
export const CART_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function currentCartToken(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(CART_TOKEN_COOKIE)?.value ?? '';
  return token === '' ? null : token;
}

/**
 * Write the basket cookie.
 *
 * Only ever called with a token the `cart` module just minted alongside a real
 * row — a cookie pointing at a cart that does not exist would make every
 * subsequent request look like a corrupted basket rather than a new one.
 */
export async function setCartTokenCookie(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(CART_TOKEN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: CART_TOKEN_MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });
}
