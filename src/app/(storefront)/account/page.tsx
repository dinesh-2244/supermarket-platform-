import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MIN_CUSTOMER_PASSWORD_LENGTH } from '@/modules/customers';
import { currentStorefrontPrincipal } from '@/storefront';
import { changePasswordAction, signOutAction, updateProfileAction } from './actions';
import { ActionForm, Field } from '../form';
import { Card } from '../ui';
import { AccountNavTabs } from './account-ui';

export const metadata: Metadata = {
  title: 'Your account | Munder Fresh',
  description: 'Manage your profile details, delivery addresses, and account security.',
};

/**
 * Customer Account Dashboard (D6/D7).
 *
 * Guarded here for active customer session.
 */
export default async function AccountPage(): Promise<React.ReactElement> {
  const { customer } = await currentStorefrontPrincipal();
  if (customer === null) redirect('/account/sign-in');

  const customerInitial = customer.name?.trim()
    ? customer.name.trim().charAt(0).toUpperCase()
    : 'C';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Profile Header Banner */}
      <div className="mb-6 rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-emerald-700 text-white font-black text-2xl shadow-xs">
            {customerInitial}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 truncate">
                {customer.name ?? 'Your account'}
              </h1>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                Verified Shopper
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600 truncate">
              {customer.email ?? 'No email on file'}
            </p>
            {customer.phone ? (
              <p className="mt-0.5 text-xs text-slate-500">📱 {customer.phone}</p>
            ) : null}
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <AccountNavTabs active="home" />

      {/* Quick Navigation Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:border-emerald-300 hover:shadow-sm">
          <div className="flex items-start gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 text-lg">
              📍
            </span>
            <div>
              <p className="font-bold text-slate-900">Delivery addresses</p>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                Manage saved quarters & community addresses for 1-click delivery.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <Link
              href="/account/addresses"
              className="inline-flex min-h-[44px] items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition"
            >
              <span>Manage saved addresses</span>
              <span>→</span>
            </Link>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs transition hover:border-emerald-300 hover:shadow-sm">
          <div className="flex items-start gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 text-lg">
              📦
            </span>
            <div>
              <p className="font-bold text-slate-900">Order history</p>
              <p className="mt-1 text-xs text-slate-500 leading-relaxed">
                Check delivery status and tracking for scheduled grocery orders.
              </p>
            </div>
          </div>
          <div className="mt-4">
            <Link
              href="/account/orders"
              className="inline-flex min-h-[44px] items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition"
            >
              <span>View past orders</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Personal Details Card */}
      <Card
        title="Your details"
        className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs mb-6"
      >
        <ActionForm
          action={updateProfileAction}
          submitLabel="Save"
          submitButtonClassName="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition disabled:opacity-50"
          className="flex flex-col gap-4 sm:max-w-md"
        >
          <Field
            label="Name"
            name="name"
            defaultValue={customer.name}
            width="w-full"
            autoComplete="name"
          />
          <Field
            label="Mobile number"
            name="phone"
            defaultValue={customer.phone}
            width="w-full"
            autoComplete="tel"
          />
        </ActionForm>
        <p className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-500 leading-relaxed">
          Your email is{' '}
          <span className="font-semibold text-slate-700">{customer.email ?? 'not set'}</span>.
          Changing it needs email confirmation, which is not set up yet.
        </p>
      </Card>

      {/* Password Management Card */}
      <Card
        title="Change your password"
        className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs mb-6"
      >
        <p className="mb-4 text-sm text-slate-600">
          Changing your password signs you out everywhere, including here.
        </p>
        <ActionForm
          action={changePasswordAction}
          submitLabel="Change password"
          submitButtonClassName="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition disabled:opacity-50"
          className="flex flex-col gap-4 sm:max-w-md"
        >
          <Field
            label="Current password"
            name="currentPassword"
            type="password"
            width="w-full"
            required
            autoComplete="current-password"
          />
          <Field
            label={`New password (at least ${String(MIN_CUSTOMER_PASSWORD_LENGTH)} characters)`}
            name="newPassword"
            type="password"
            width="w-full"
            required
            autoComplete="new-password"
          />
        </ActionForm>
      </Card>

      {/* Sign Out Card */}
      <Card className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-bold text-slate-900">Sign out of this device</p>
          <p className="text-xs text-slate-500 mt-0.5">
            You can sign back in anytime to access your saved addresses.
          </p>
        </div>
        <form action={signOutAction}>
          <button
            type="submit"
            className="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition"
          >
            Sign out
          </button>
        </form>
      </Card>
    </div>
  );
}
