import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentCustomer } from '@/storefront';
import { signInAction } from '../actions';
import { ActionForm, Field } from '../../form';
import { Card } from '../../ui';
import { AccountOptionalNotice } from '../account-ui';

export const metadata: Metadata = {
  title: 'Sign in | Munder Fresh',
  description: 'Sign in to access your saved delivery addresses and synced grocery basket.',
};

/**
 * Customer Sign-In (D6).
 *
 * Accounts are completely optional. Guest checkout is always available.
 */
export default async function CustomerSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  // Already signed in: redirect to account dashboard
  if ((await currentCustomer()) !== null) redirect('/account');
  const changed = (await searchParams).changed === '1';

  return (
    <div className="mx-auto max-w-lg px-4 py-8 sm:py-12">
      <div className="mb-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 shadow-xs">
          <svg
            className="h-7 w-7 text-emerald-700"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
            />
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">Sign in</h1>
        <p className="mt-1.5 text-sm text-slate-600">
          An account is optional — you can shop and check out without one.
        </p>
      </div>

      <AccountOptionalNotice className="mb-6 rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-4 text-xs sm:text-sm text-emerald-950 flex items-start gap-3 shadow-xs" />

      {changed ? (
        <div className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 shadow-xs">
          Your password is changed, and every device has been signed out. Sign in again with the new
          one.
        </div>
      ) : null}

      <Card className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs mb-6">
        <ActionForm
          action={signInAction}
          submitLabel="Sign in"
          submitButtonClassName="w-full min-h-[44px] inline-flex items-center justify-center rounded-xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition disabled:opacity-50"
          className="flex flex-col gap-4"
        >
          <Field
            label="Email"
            name="email"
            type="email"
            width="w-full"
            required
            autoComplete="email"
            placeholder="shopper@example.com"
          />
          <Field
            label="Password"
            name="password"
            type="password"
            width="w-full"
            required
            autoComplete="current-password"
            placeholder="••••••••"
          />
        </ActionForm>
      </Card>

      <div className="space-y-4 text-center">
        <p className="text-sm text-slate-600">
          No account yet?{' '}
          <Link
            href="/account/sign-up"
            className="inline-flex min-h-[44px] items-center font-bold text-emerald-800 underline hover:text-emerald-900"
          >
            Create one
          </Link>
          .
        </p>

        {/* Honest statement of known email gap per project specs */}
        <p className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 text-xs text-slate-500 leading-relaxed">
          Forgotten your password? We cannot reset it yet — that needs email, which is not set up.
          Please get in touch with the shop.
        </p>

        <div>
          <Link
            href="/shop"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 py-2 transition"
          >
            <span>←</span>
            <span>Continue shopping as guest</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
