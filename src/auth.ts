import Credentials from 'next-auth/providers/credentials';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import { AuthzError, type Principal } from '@/modules/platform';
import {
  createSessionForUser,
  destroySession,
  readSession,
  SESSION_MAX_AGE_SECONDS,
  verifyCredentials,
} from '@/modules/identity';

/**
 * Staff authentication (arch §5, §20). Email + argon2id password; **no public
 * signup** — a `SUPER_ADMIN` creates every account.
 *
 * ## Why the session handling is written out rather than left to the adapter
 *
 * Auth.js v5's **credentials** provider cannot use `strategy: 'database'`: for
 * it the adapter's `createSession` is never called, and asking for it anyway
 * silently leaves you on a self-contained JWT. A stateless token is exactly what
 * this phase must not have — the Definition of Done requires that signing out
 * and *disabling a user* invalidate live sessions, and a JWT cannot be revoked
 * before it expires.
 *
 * So the cookie carries **only an opaque session id** and the row it points at
 * lives in the `Session` table:
 *
 * - **sign-in** mints a new row, which is what makes rotation real — every login
 *   gets a new token and the previous one is never re-blessed;
 * - **every request** re-reads that row *and* the user behind it, so a role
 *   change, a store move or a disable lands on the next request rather than
 *   whenever a token happens to expire;
 * - **sign-out** deletes the row.
 *
 * Nothing about role or store is ever stored in the token — there is therefore
 * nothing in it worth tampering with, and no stale authority to honour.
 */
export const authConfig = {
  trustHost: true,
  session: {
    // A thin carrier for the opaque session id, never the identity itself.
    // `readSession` is what actually decides who you are.
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  pages: { signIn: '/admin/sign-in', error: '/admin/sign-in' },
  providers: [
    Credentials({
      name: 'Staff credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        totp: { label: 'Authenticator code', type: 'text' },
      },
      authorize: async (raw) => {
        const email = typeof raw.email === 'string' ? raw.email : '';
        const password = typeof raw.password === 'string' ? raw.password : '';
        const totp = typeof raw.totp === 'string' ? raw.totp : '';
        if (email === '' || password === '') return null;

        // One undifferentiated failure for unknown email, wrong password,
        // disabled account and a missing or wrong second factor — the form must
        // not double as an oracle for which addresses have accounts, nor for
        // which of those have 2FA switched on.
        const user = await verifyCredentials(email, password, totp);
        if (user === null) return null;

        const session = await createSessionForUser(user.id);
        return { id: user.id, email: user.email, name: user.name, st: session.token };
      },
    }),
  ],
  callbacks: {
    jwt: ({ token, user }) => {
      // `user` exists only on sign-in; afterwards the token just carries the
      // session id forward.
      if (user && 'st' in user && typeof user.st === 'string') token.st = user.st;
      return token;
    },
    session: async ({ session, token }) => {
      const st = typeof token.st === 'string' ? token.st : null;
      const active = st === null ? null : await readSession(st);

      if (active === null) {
        // Revoked, expired, or the user was disabled: present as signed out.
        return { ...session, expires: new Date(0).toISOString() };
      }

      // Role and store come from the row just read, not from the token, so they
      // are never stale — that is the whole reason the lookup happens here.
      return {
        ...session,
        expires: active.expires.toISOString(),
        user: {
          id: active.user.id,
          email: active.user.email,
          name: active.user.name,
          role: active.user.role,
          storeId: active.user.storeId,
        },
      };
    },
  },
  events: {
    signOut: async (message) => {
      const token = 'token' in message ? message.token : null;
      const st = token != null && typeof token.st === 'string' ? token.st : null;
      if (st !== null) await destroySession(st);
    },
  },
} satisfies NextAuthConfig;

export const { handlers, signIn, signOut, auth } = NextAuth(authConfig);

/**
 * The authorization principal for the current request, or `null` when signed out.
 *
 * Built from the freshly-read `Session` + `User` rows, never from the cookie.
 * This is what every server action and route handler calls — middleware only
 * redirects, it does not authorize (see `src/middleware.ts`).
 */
export async function currentPrincipal(): Promise<Principal | null> {
  const session = await auth();
  const user = session?.user;
  if (!user || typeof user.id !== 'string') return null;

  const role = user.role;
  if (role !== 'SUPER_ADMIN' && role !== 'STORE_MANAGER' && role !== 'STORE_STAFF') return null;

  return {
    kind: 'user',
    userId: user.id,
    role,
    storeId: typeof user.storeId === 'string' ? user.storeId : null,
  };
}

/**
 * The principal, or an `AuthzError` — the opening line of every mutating server
 * action. Never returns a partial or anonymous principal: there is no "signed in
 * but unknown role" state to accidentally treat as permissive.
 */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await currentPrincipal();
  if (principal === null) {
    throw new AuthzError('You must be signed in', { reason: 'no active session' });
  }
  return principal;
}
