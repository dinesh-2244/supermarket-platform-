import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orderForTracking } from '@/modules/orders';
import { rupees, PageHeading } from '../../ui';

export const metadata: Metadata = {
  title: 'Order placed',
  description: 'Your order is with the shop.',
  robots: { index: false, follow: false },
};

/**
 * The order-confirmation page (D4).
 *
 * Reached by redirect straight after placing, and readable afterwards by anyone
 * holding the link — it is the same read as `/order-status/<token>`, which is
 * why it goes through the same opaque token rather than an order id. A shopper
 * who closes the tab still has a way back in through the link.
 */
export default async function OrderPlacedPage({
  params,
}: {
  params: Promise<{ trackingToken: string }>;
}): Promise<React.ReactElement> {
  const { trackingToken } = await params;
  const order = await orderForTracking(trackingToken);
  if (order === null) notFound();

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2 sm:py-6">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-50 border border-emerald-200/80 text-emerald-700 shadow-xs">
          <svg
            className="h-8 w-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M5 13l4 4L19 7"
            />
          </svg>
        </div>
        <PageHeading
          title="Thank you — your order is placed"
          subtitle="The shop has it now. You will pay when it is delivered."
        />
      </div>

      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-5">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500 block">
              Order number
            </span>
            <span className="font-mono text-xl sm:text-2xl font-black text-slate-900">
              {order.orderNumber}
            </span>
          </div>
          <span className="rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-1.5 text-xs font-bold text-emerald-800">
            Order placed
          </span>
        </div>

        <dl className="mt-5 space-y-3.5 text-sm">
          <Line label="Delivery window" value={order.slotLabel} />
          <Line
            label="Paying by"
            value={order.paymentMethod === 'COD' ? 'Cash on delivery' : 'UPI on delivery'}
          />
          <div className="border-t border-slate-100 pt-3.5 flex flex-wrap justify-between items-baseline gap-2">
            <dt className="text-sm font-bold text-slate-900">Estimated total</dt>
            <dd className="text-xl font-black text-slate-900">
              {rupees(order.estimatedTotalPaise)}
            </dd>
          </div>
        </dl>

        <p className="mt-4 rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-xs text-slate-600 leading-relaxed">
          The final amount is confirmed when the shop bills your order.
        </p>

        <div className="mt-6 rounded-2xl border border-emerald-200/80 bg-emerald-50/40 p-5">
          <p className="text-sm font-bold text-emerald-950">Follow it here any time:</p>
          <div className="mt-3 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <Link
              href={`/order-status/${order.trackingToken}`}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition"
            >
              track this order →
            </Link>
            <p className="text-xs text-emerald-900/90 leading-relaxed">
              Save or bookmark this link to check your order delivery updates anytime without an
              account.
            </p>
          </div>
        </div>
      </div>

      <div className="text-center pt-2">
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-8 py-2.5 text-sm font-bold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-[0.99] transition"
        >
          Keep shopping
        </Link>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-slate-600 font-medium">{label}</dt>
      <dd
        className={strong === true ? 'font-black text-slate-900' : 'font-semibold text-slate-800'}
      >
        {value}
      </dd>
    </div>
  );
}
