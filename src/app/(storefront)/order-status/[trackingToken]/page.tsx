import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orderForTracking, type TimelineStep } from '@/modules/orders';
import { rupees } from '../../ui';

export const metadata: Metadata = {
  title: 'Track your order',
  description: 'Where your order has got to.',
  // The token is the credential; a search engine holding one would be a leak.
  robots: { index: false, follow: false },
};

/**
 * The guest order-status page (D5).
 *
 * **Read-only, no login, opaque token.** There is no account to sign in to and
 * nothing on this page mutates anything — the service method it calls has no
 * write variant. A shopper who has the link can see their order; that is the
 * whole authorization model (§11), and it is why the token is 100 bits of
 * CSPRNG output rather than an order id.
 *
 * Any token that does not resolve — malformed, well-formed but unknown, or
 * somebody else's that has since been deleted — produces the **same** generic
 * 404 as a mistyped URL. `orderForTracking` is one indexed lookup on a unique
 * column either way, so there is no timing difference to measure and no way to
 * tell "no such order" from "not yours".
 */
export default async function OrderStatusPage({
  params,
}: {
  params: Promise<{ trackingToken: string }>;
}): Promise<React.ReactElement> {
  const { trackingToken } = await params;
  const order = await orderForTracking(trackingToken);
  if (order === null) notFound();

  const cancelled = order.status === 'CANCELLED_BY_STORE';

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2 sm:py-6">
      <div className="border-b border-slate-200/80 pb-5">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
          Order {order.orderNumber}
        </h1>
        <p className="mt-1 text-sm text-slate-500 font-medium">Placed with {order.storeName}.</p>
      </div>

      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs space-y-5">
        <div
          className={`flex items-center gap-2.5 rounded-2xl border px-4 py-3.5 text-sm sm:text-base font-bold ${
            cancelled
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-950'
          }`}
        >
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
              cancelled ? 'bg-red-200 text-red-900' : 'bg-emerald-200 text-emerald-900'
            }`}
            aria-hidden="true"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={cancelled ? 'M6 18L18 6M6 6l12 12' : 'M5 13l4 4L19 7'}
              />
            </svg>
          </span>
          <p role="status">{order.statusLabel}</p>
        </div>

        <dl className="space-y-3 text-sm">
          <Row label="Delivery window" value={order.slotLabel} />
          {order.deliveryLocality === null ? null : (
            <Row label="Delivering to" value={order.deliveryLocality} />
          )}
          <Row
            label="Paying by"
            value={order.paymentMethod === 'COD' ? 'Cash on delivery' : 'UPI on delivery'}
          />
        </dl>
      </div>

      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs">
        <h2 className="text-base sm:text-lg font-bold text-slate-900">Progress</h2>
        <ol className="mt-5 space-y-4 border-l-2 border-slate-100 ml-2 pl-4">
          {order.timeline.map((step, index) => (
            <Step key={`${step.status}-${index}`} step={step} timeZone={order.storeTimeZone} />
          ))}
        </ol>
      </div>

      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs">
        <h2 className="text-base sm:text-lg font-bold text-slate-900">What you ordered</h2>
        <ul className="mt-4 divide-y divide-slate-100">
          {order.lines.map((line) => (
            <li key={line.name} className="flex justify-between gap-3 py-3 text-sm">
              <span className="min-w-0">
                <span className="font-semibold text-slate-900">{line.name}</span>
                <span className="text-slate-500 block text-xs sm:inline sm:text-sm mt-0.5 sm:mt-0">
                  {' '}
                  · {line.packSize} × {line.qty} at {rupees(line.unitPricePaise)}
                </span>
              </span>
              <span className="shrink-0 font-bold text-slate-900">
                {rupees(line.lineTotalPaise)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
          <Row label="Subtotal" value={rupees(order.subtotalPaise)} />
          <Row label="Delivery" value={rupees(order.deliveryFeePaise)} />
          <div className="border-t border-slate-100 pt-2 flex flex-wrap justify-between items-baseline gap-2">
            <dt className="text-sm font-bold text-slate-900">Estimated total</dt>
            <dd className="text-xl font-black text-slate-900">
              {rupees(order.estimatedTotalPaise)}
            </dd>
          </div>
        </dl>
        <p className="mt-4 rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-xs text-slate-600 leading-relaxed">
          Prices are what you were quoted when you ordered. The final amount is confirmed when the
          shop bills your order.
        </p>
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

function Row({
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

/**
 * One step, timed in the **shop's** timezone like everything else on this page.
 * A shopper reading "picked at 03:00" because their phone is in another country
 * would be told something true and useless.
 */
function Step({ step, timeZone }: { step: TimelineStep; timeZone: string }): React.ReactElement {
  const when = new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(step.at);

  return (
    <li className="relative flex flex-wrap items-baseline justify-between gap-2 text-sm pl-2">
      <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-emerald-600 ring-4 ring-white" />
      <span className="font-semibold text-slate-900">{step.label}</span>
      <time
        dateTime={step.at.toISOString()}
        className="text-xs font-medium text-slate-500 font-mono"
      >
        {when}
      </time>
    </li>
  );
}
