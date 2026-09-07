import type { UserRole } from '@/modules/platform';

/**
 * Auth.js's `Session.user` is `{ name?, email?, image? }` by default. The
 * session callback in `src/auth.ts` replaces it with rows read fresh from the
 * database on every request, so the type has to say so — otherwise every caller
 * would need a cast to reach the two fields authorization is decided from.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      storeId: string | null;
    };
  }
}

export {};
