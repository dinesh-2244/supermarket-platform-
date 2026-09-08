import { NextResponse, type NextRequest } from 'next/server';

/**
 * A **first** gate on `/admin/*`, never the only one.
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

export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;

  // The sign-in page itself must stay reachable while signed out.
  if (pathname === '/admin/sign-in') return NextResponse.next();

  const hasSessionCookie = SESSION_COOKIES.some(
    (name) => (request.cookies.get(name)?.value ?? '') !== '',
  );
  if (hasSessionCookie) return NextResponse.next();

  const signIn = new URL('/admin/sign-in', request.url);
  signIn.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ['/admin/:path*'],
};
