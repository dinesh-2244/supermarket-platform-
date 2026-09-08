import { NextResponse, type NextRequest } from 'next/server';

/**
 * A **first** gate on `/admin/*` and `/account/*`, never the only one.
 *
 * Middleware runs on the edge runtime, where there is no database — so it can
 * check that a session cookie is *present*, not that it is valid, not who it
 * belongs to, and not what they may do. Treating it as the boundary is how an
 * app ends up with authorization that a direct POST to a server action walks
 * straight past. Every server action and route handler therefore re-checks
 * `authorize(...)` against a principal read from the database (arch §5).
 *
 * What this buys is a redirect to the sign-in page instead of an error, for the
 * overwhelmingly common case of a signed-out person clicking a bookmark.
 */
const SESSION_COOKIES = [
  'authjs.session-token',
  '__Secure-authjs.session-token',
  'next-auth.session-token',
  '__Secure-next-auth.session-token',
];

/**
 * The shopper's cookie. A **different** cookie from the staff ones above,
 * naming a row in a different table (ADR-0010) — which is why this file can
 * treat them as unrelated rather than trying to tell one bearer apart from
 * another.
 */
const CUSTOMER_SESSION_COOKIE = 'customerSession';

/** Pages under `/account` that exist precisely for people with no session. */
const PUBLIC_ACCOUNT_PATHS = new Set(['/account/sign-in', '/account/sign-up']);

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/account')) {
    // A guard that redirected these would make its own sign-in page
    // unreachable — the loop the admin sign-in page already taught us about.
    if (PUBLIC_ACCOUNT_PATHS.has(pathname)) return NextResponse.next();
    if (has(request, [CUSTOMER_SESSION_COOKIE])) return NextResponse.next();
    return NextResponse.redirect(new URL('/account/sign-in', request.url));
  }

  // The sign-in page itself must stay reachable while signed out.
  if (pathname === '/admin/sign-in') return NextResponse.next();

  if (has(request, SESSION_COOKIES)) return NextResponse.next();

  const signIn = new URL('/admin/sign-in', request.url);
  signIn.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

function has(request: NextRequest, names: readonly string[]): boolean {
  return names.some((name) => (request.cookies.get(name)?.value ?? '') !== '');
}

export const config = {
  matcher: ['/admin/:path*', '/account/:path*'],
};
