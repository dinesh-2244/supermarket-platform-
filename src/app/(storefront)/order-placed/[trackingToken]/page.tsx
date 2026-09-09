import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orderForTracking } from '@/modules/orders';
import { rupees, Card, PageHeading } from '../../ui';

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
    <>
      <PageHeading
        title="Thank you — your order is placed"
        subtitle="The shop has it now. You will pay when it is delivered."
      />

      <Card>
        <dl className="space-y-2 text-sm">
          <Line label="Order number" value={order.orderNumber} strong />
          <Line label="Delivery window" value={order.slotLabel} />
          <Line
            label="Paying by"
            value={order.paymentMethod === 'COD' ? 'Cash on delivery' : 'UPI on delivery'}
          />
          <Line label="Estimated total" value={rupees(order.estimatedTotalPaise)} strong />
        </dl>

        <p className="mt-3 text-xs text-slate-600">
          The final amount is confirmed when the shop bills your order.
        </p>

        <p className="mt-4 text-sm">
          Follow it here any time:{' '}
          <Link
            href={`/order-status/${order.trackingToken}`}
            className="text-emerald-800 underline"
          >
            track this order
          </Link>
          .
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
      <dt className="text-slate-600">{label}</dt>
      <dd className={strong === true ? 'font-semibold' : ''}>{value}</dd>
    </div>
  );
}
