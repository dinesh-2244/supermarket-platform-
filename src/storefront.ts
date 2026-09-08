import { cookies } from 'next/headers';
import { readCustomerSession, type CustomerProfile } from '@/modules/customers';
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

/**
 * Forget which area the visitor picked.
 *
 * Called wherever a context stops being valid, not only from the header's
 * "change area" control: a picker submission that turns out to be unserviceable
 * used to leave the *previous* context in place, so the shopper was sent to the
 * "we are not there yet" page and could then walk straight back into the old
 * shop's basket and buy from it (R5). The cart cookie is deliberately untouched
 * — a shopper between addresses keeps their basket (D5); it simply has no shop
 * to be rendered against until they choose again.
 */
export async function clearStoreContext(): Promise<void> {
  const jar = await cookies();
  jar.delete(STORE_CONTEXT_COOKIE);
}

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

// ---------------------------------------------------------------------------
// One-shot notices
// ---------------------------------------------------------------------------

/**
 * A message that survives a redirect.
 *
 * Moving a basket between shops happens during a redirect, so the page that
 * must explain what carried over and what was dropped is not the page that did
 * the work. A short-lived `HttpOnly` cookie carries the summary across.
 *
 * Deliberately not a query string: the summary names products, and a URL people
 * bookmark and share is the wrong place for the contents of their basket.
 *
 * **It is cleared by the next server action, not by reading it.** Next.js only
 * permits cookie mutation in a server action or route handler — a page that
 * deleted it while rendering crashes the request — so the notice is dropped by
 * `clearCartMoveNotice` at the start of every basket action and every area
 * change, and expires on its own after a minute regardless. The effect a
 * shopper sees is the same: it appears once, and goes as soon as they do
 * anything at all.
 */
export const CART_NOTICE_COOKIE = 'cartNotice';

export interface CartMoveNotice {
  readonly storeName: string;
  readonly carried: readonly string[];
  readonly dropped: readonly string[];
}

/** Names are capped so a large basket cannot produce an unusable header. */
const MAX_NAMED = 6;

export async function setCartMoveNotice(notice: CartMoveNotice): Promise<void> {
  const jar = await cookies();
  jar.set(
    CART_NOTICE_COOKIE,
    JSON.stringify({
      storeName: notice.storeName,
      carried: notice.carried.slice(0, MAX_NAMED),
      dropped: notice.dropped.slice(0, MAX_NAMED),
      carriedTotal: notice.carried.length,
      droppedTotal: notice.dropped.length,
    }),
    {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60,
      secure: process.env.NODE_ENV === 'production',
    },
  );
}

export interface ReadCartMoveNotice extends CartMoveNotice {
  readonly carriedTotal: number;
  readonly droppedTotal: number;
}

/**
 * Read the notice, if there is one.
 *
 * Everything is re-validated on the way out, because a cookie is a cookie: a
 * hand-written one can only ever produce a harmless message, never a claim the
 * page acts on.
 */
export async function readCartMoveNotice(): Promise<ReadCartMoveNotice | null> {
  const jar = await cookies();
  const raw = jar.get(CART_NOTICE_COOKIE)?.value ?? '';
  if (raw === '') return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const value = parsed as Record<string, unknown>;
    return {
      storeName: typeof value.storeName === 'string' ? value.storeName : 'your new shop',
      carried: stringList(value.carried),
      dropped: stringList(value.dropped),
      carriedTotal: typeof value.carriedTotal === 'number' ? value.carriedTotal : 0,
      droppedTotal: typeof value.droppedTotal === 'number' ? value.droppedTotal : 0,
    };
  } catch {
    return null;
  }
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string').slice(0, MAX_NAMED);
}

/** Drop the notice. Only callable from a server action — see the note above. */
export async function clearCartMoveNotice(): Promise<void> {
  const jar = await cookies();
  jar.delete(CART_NOTICE_COOKIE);
}

// ---------------------------------------------------------------------------
// Customer session
// ---------------------------------------------------------------------------

/**
 * The shopper's session cookie (ADR-0010).
 *
 * A **different cookie from the staff one**, pointing at a row in a different
 * table. That is what makes the isolation structural rather than conditional:
 * a staff cookie names no `CustomerSession` row and this one names no
 * `Session` row, so neither can be mistaken for the other even by mistake.
 *
 * `HttpOnly`, `SameSite=Lax`, and carrying only a 256-bit opaque id — the name,
 * the addresses and the account state are all re-read from the row on every
 * request.
 */
export const CUSTOMER_SESSION_COOKIE = 'customerSession';

export async function currentCustomerToken(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_SESSION_COOKIE)?.value ?? '';
  return token === '' ? null : token;
}

export async function setCustomerSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(CUSTOMER_SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
    secure: process.env.NODE_ENV === 'production',
  });
}

export async function clearCustomerSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(CUSTOMER_SESSION_COOKIE);
}

/**
 * The signed-in shopper for this request, or `null`.
 *
 * Built from the freshly-read `CustomerSession` + `Customer` rows, never from
 * the cookie — so blocking an account takes effect on the next page load rather
 * than whenever the token happens to expire.
 */
export async function currentCustomer(): Promise<CustomerProfile | null> {
  const token = await currentCustomerToken();
  if (token === null) return null;
  const session = await readCustomerSession(token);
  return session?.customer ?? null;
}

/**
 * The storefront principal for this request, with the shopper folded in.
 *
 * One call, so no page can accidentally build a principal that knows the store
 * but not the shopper (an account page that read nobody's addresses) or the
 * shopper but not the store (a basket that could reach the other shop).
 */
export async function currentStorefrontPrincipal(): Promise<{
  context: StoreContext | null;
  customer: CustomerProfile | null;
  principal: Principal;
}> {
  const [context, customer] = await Promise.all([currentStoreContext(), currentCustomer()]);
  return { context, customer, principal: storefrontPrincipal(context, customer?.id ?? null) };
}
