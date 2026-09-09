import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orderForTracking, type TimelineStep } from '@/modules/orders';
import { rupees, Card, PageHeading } from '../../ui';

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
    <>
      <PageHeading
        title={`Order ${order.orderNumber}`}
        subtitle={`Placed with ${order.storeName}.`}
      />

      <Card>
        <p
          role="status"
          className={`rounded border px-3 py-2 text-sm ${
            cancelled
              ? 'border-red-200 bg-red-50 text-red-800'
              : 'border-emerald-200 bg-emerald-50 text-emerald-900'
          }`}
        >
          {order.statusLabel}
        </p>

        <dl className="mt-3 space-y-2 text-sm">
          <Row label="Delivery window" value={order.slotLabel} />
          {order.deliveryLocality === null ? null : (
            <Row label="Delivering to" value={order.deliveryLocality} />
          )}
          <Row
            label="Paying by"
            value={order.paymentMethod === 'COD' ? 'Cash on delivery' : 'UPI on delivery'}
          />
        </dl>
      </Card>

      <Card title="Progress">
        <ol className="space-y-2">
          {order.timeline.map((step, index) => (
            <Step key={`${step.status}-${index}`} step={step} timeZone={order.storeTimeZone} />
          ))}
        </ol>
      </Card>

      <Card title="What you ordered">
        <ul className="divide-y divide-slate-100">
          {order.lines.map((line) => (
            <li key={line.name} className="flex justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                {line.name}
                <span className="text-slate-500">
                  {' '}
                  · {line.packSize} × {line.qty} at {rupees(line.unitPricePaise)}
                </span>
              </span>
              <span className="shrink-0 font-medium">{rupees(line.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <Row label="Subtotal" value={rupees(order.subtotalPaise)} />
          <Row label="Delivery" value={rupees(order.deliveryFeePaise)} />
          <Row label="Estimated total" value={rupees(order.estimatedTotalPaise)} strong />
        </dl>
        <p className="mt-2 text-xs text-slate-600">
          Prices are what you were quoted when you ordered. The final amount is confirmed when the
          shop bills your order.
        </p>
      </Card>

      <p className="text-sm">
        <Link href="/" className="text-emerald-800 underline">
          Keep shopping
        </Link>
      </p>
    </>
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
      <dt className="text-slate-600">{label}</dt>
      <dd className={strong === true ? 'font-semibold' : ''}>{value}</dd>
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
    <li className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <span className="font-medium">{step.label}</span>
      <time dateTime={step.at.toISOString()} className="text-xs text-slate-500">
        {when}
      </time>
    </li>
  );
}
