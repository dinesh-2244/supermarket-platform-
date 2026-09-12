import { redirect } from 'next/navigation';
import { currentPrincipal } from '@/auth';
import { navigationFor } from '@/modules/admin';
import { signOutAction } from './actions';
import { AdminNavShell } from './nav';

/**
 * The back-office shell (AD2).
 *
 * Guarded server-side: redirects visitors without an active user session to sign-in.
 * Navigation is role-gated per navigationFor(principal.role).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const principal = await currentPrincipal();
  if (principal?.kind !== 'user') redirect('/admin/sign-in');

  const navItems = navigationFor(principal.role);
  const allowedHrefs = navItems.map((item) => item.href);

  const signOutForm = (
    <form action={signOutAction} className="w-full">
      <button
        type="submit"
        className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:bg-slate-700 hover:text-white transition active:scale-[0.99]"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
          />
        </svg>
        <span>Sign out</span>
      </button>
    </form>
  );

  return (
    <AdminNavShell role={principal.role} allowedHrefs={allowedHrefs} signOutForm={signOutForm}>
      {children}
    </AdminNavShell>
  );
}
