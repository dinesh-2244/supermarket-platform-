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

/**
 * A Server Action submission, which must be answered rather than redirected.
 *
 * Next.js posts these with a `Next-Action` header and expects a Server Action
 * response; a 307 to an HTML sign-in page is not one, and the client throws an
 * application error rather than showing anything a person can act on. That is
 * what a staff form does when the session behind it has gone — expired, signed
 * out in another tab, or replaced by a shopper's cookie (N1).
 *
 * Letting it through costs no authorization. Middleware runs on the edge with no
 * database and never authorized anything (see the note above): the action's own
 * `requirePrincipal()` reads the session from the database and refuses, and the
 * refusal renders in the form's own notice — the graceful transition instead of
 * a crash.
 */
function isServerAction(request: NextRequest): boolean {
  return request.method === 'POST' && request.headers.has('next-action');
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  if (isServerAction(request)) return NextResponse.next();

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
