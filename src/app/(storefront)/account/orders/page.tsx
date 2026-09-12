import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentCustomer } from '@/storefront';
import { Card, Empty } from '../../ui';
import { AccountBackLink, AccountNavTabs } from '../account-ui';

export const metadata: Metadata = {
  title: 'Your orders | Munder Fresh',
  description: 'Track your scheduled grocery orders and view past delivery history.',
};

/**
 * Order history page (D7).
 *
 * Scoped to active customer sessions.
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
          Track scheduled deliveries and view past grocery orders.
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

        <p className="text-lg font-bold text-slate-900">No orders yet.</p>
        <Empty>You do not have any active or past orders on this account.</Empty>

        <p className="mt-2 text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
          Ordering arrives in the next release. Until then you can{' '}
          <Link href="/" className="font-bold text-emerald-800 underline hover:text-emerald-900">
            fill a basket
          </Link>{' '}
          and it will be waiting.
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

      {/* Guest Order Tracking Info Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 shadow-xs">
        <div className="flex items-start gap-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 text-base">
            🔍
          </span>
          <div className="space-y-1">
            <p className="font-bold text-slate-900 text-sm">Placed an order as a guest?</p>
            <p className="text-xs text-slate-600 leading-relaxed">
              Every order includes a private tracking token in your confirmation link. You can track
              your scheduled delivery status anytime directly from that link without needing to sign
              in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
