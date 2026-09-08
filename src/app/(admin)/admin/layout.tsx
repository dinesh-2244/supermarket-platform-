import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentPrincipal } from '@/auth';
import { navigationFor } from '@/modules/admin';
import { signOutAction } from './actions';

/**
 * The back-office shell.
 *
 * The guard here is a **second** check, not the first and not the last:
 * middleware has already redirected anyone with no session cookie, and every
 * server action re-checks `authorize(...)` itself. This one exists so a signed-in
 * person with a revoked session lands on sign-in instead of a stack trace, and
 * so the nav only offers pages the role can actually open.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const principal = await currentPrincipal();
  if (principal?.kind !== 'user') redirect('/admin/sign-in');

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold">Back office</span>
          <nav className="flex flex-wrap gap-3 text-sm">
            {navigationFor(principal.role).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-slate-600 hover:text-slate-900"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <form action={signOutAction} className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-slate-500">{principal.role.replace('_', ' ').toLowerCase()}</span>
            <button type="submit" className="rounded border border-slate-300 px-2 py-1">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
