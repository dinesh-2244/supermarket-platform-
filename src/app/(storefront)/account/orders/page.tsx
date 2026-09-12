import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentCustomer } from '@/storefront';
import { Card } from '../../ui';
import { AccountBackLink, AccountNavTabs } from '../account-ui';

export const metadata: Metadata = {
  title: 'Your orders | Munder Fresh',
  description: 'Track your scheduled grocery orders and view delivery status.',
};

/**
 * Order history page (D7).
 *
 * Scoped to active customer sessions. Order history in account dashboard is
 * not yet available; delivery status is tracked via private tracking links.
 */
export default async function OrderHistoryPage(): Promise<React.ReactElement> {
  if ((await currentCustomer()) === null) redirect('/account/sign-in');

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <AccountBackLink />

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
          Your orders
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Order tracking and scheduled grocery delivery status.
        </p>
      </div>

      <AccountNavTabs active="orders" />

      {/* Main Order History Card */}
      <Card className="rounded-3xl border border-slate-200/90 bg-white p-8 sm:p-12 text-center shadow-xs mb-6">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          <svg
            className="h-10 w-10 text-emerald-700"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
        </div>

        <p className="text-lg font-bold text-slate-900">
          Account order history is not available yet
        </p>
        <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
          Order history inside your account dashboard is not available yet. Orders placed while
          signed in are recorded on your account, and live delivery status is provided through your
          private order tracking link.
        </p>

        <p className="mt-3 text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
          Check your order confirmation message for your private tracking link to follow your
          delivery in real time.
        </p>

        <div className="mt-6">
          <Link
            href="/"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition"
          >
            Start shopping
          </Link>
        </div>
      </Card>

      {/* Order Tracking Assistance Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 shadow-xs">
        <div className="flex items-start gap-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 text-base">
            🔍
          </span>
          <div className="space-y-1">
            <p className="font-bold text-slate-900 text-sm">Tracking your scheduled order?</p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Every order confirmation includes a private tracking token in its confirmation link.
              You can track your scheduled delivery status anytime directly from that link without
              needing to sign in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
