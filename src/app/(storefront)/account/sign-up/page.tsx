import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MIN_CUSTOMER_PASSWORD_LENGTH } from '@/modules/customers';
import { currentCustomer } from '@/storefront';
import { signUpAction } from '../actions';
import { ActionForm, Field } from '../../form';
import { Card } from '../../ui';
import { AccountOptionalNotice } from '../account-ui';

export const metadata: Metadata = {
  title: 'Create an account | Munder Fresh',
  description: 'Create an optional account to save your delivery addresses and keep your basket.',
};

/**
 * Customer Sign-Up (D6).
 *
 * Creating an account is optional. It does not sign you in (enumeration defense).
 */
export default async function CustomerSignUpPage(): Promise<React.ReactElement> {
  if ((await currentCustomer()) !== null) redirect('/account');

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
              d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"
            />
          </svg>
        </div>
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
          Create an account
        </h1>
        <p className="mt-1.5 text-sm text-slate-600">
          Optional. It saves your addresses and keeps your basket with you.
        </p>
      </div>

      <AccountOptionalNotice className="mb-6 rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-4 text-xs sm:text-sm text-emerald-950 flex items-start gap-3 shadow-xs" />

      <Card className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs mb-6">
        <ActionForm
          action={signUpAction}
          submitLabel="Create account"
          submitButtonClassName="w-full min-h-[44px] inline-flex items-center justify-center rounded-xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition disabled:opacity-50"
          className="flex flex-col gap-4"
        >
          <Field
            label="Name"
            name="name"
            width="w-full"
            required
            autoComplete="name"
            placeholder="Your full name"
          />
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
            label="Mobile number"
            name="phone"
            type="tel"
            width="w-full"
            required
            autoComplete="tel"
            placeholder="9876543210"
          />
          <Field
            label={`Password (at least ${String(MIN_CUSTOMER_PASSWORD_LENGTH)} characters)`}
            name="password"
            type="password"
            width="w-full"
            required
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </ActionForm>
      </Card>

      <div className="space-y-4 text-center">
        <p className="text-sm text-slate-600">
          Already have one?{' '}
          <Link
            href="/account/sign-in"
            className="inline-flex min-h-[44px] items-center font-bold text-emerald-800 underline hover:text-emerald-900"
          >
            Sign in
          </Link>
          .
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
