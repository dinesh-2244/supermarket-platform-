import Link from 'next/link';
import { Card, PageHeading } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Reserved Information Architecture Slot: Phase 5 Fulfillment (AD10).
 *
 * This screen reserves the IA slot for future fulfillment flows (picking,
 * short-pick, POS handoff, packing, dispatch, delivery) per Phase 5 planning,
 * without pre-building mock logic against an unbuilt backend.
 */
export default function FulfillmentSlotPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <PageHeading
        title="Fulfillment"
        subtitle="Phase 5 reserved operations surface (AD10)."
        badge={
          <span className="rounded-full bg-indigo-100 border border-indigo-200 px-3 py-0.5 text-xs font-bold text-indigo-900">
            Phase 5 Scope
          </span>
        }
      />

      <Card title="Upcoming fulfillment workflows">
        <div className="space-y-4">
          <p className="text-sm text-slate-700 leading-relaxed">
            This information architecture slot is reserved for the upcoming{' '}
            <strong>Phase 5 Fulfillment</strong> release. The full warehouse and in-store staff
            execution lifecycle will be integrated here once backend services are delivered:
          </p>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 pt-2">
            {[
              {
                title: 'Order picking',
                desc: 'Itemized pick lists, shelf location sequence, and batch picking workflows.',
              },
              {
                title: 'Short-pick & substitution',
                desc: 'Out-of-stock resolution, customer substitution policy checks, and variance logs.',
              },
              {
                title: 'POS billing handoff',
                desc: 'Handoff to POS cashiers for billing invoice generation and inventory sync.',
              },
              {
                title: 'Packing & labeling',
                desc: 'Bag verification, chilled goods separation, and delivery label generation.',
              },
              {
                title: 'Dispatch & driver assign',
                desc: 'Delivery manifest generation and courier slot departure management.',
              },
              {
                title: 'Delivery confirmation',
                desc: 'Proof of delivery, failed delivery handling, and customer order handoff.',
              },
            ].map((step) => (
              <div
                key={step.title}
                className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4"
              >
                <h3 className="text-sm font-bold text-slate-900">{step.title}</h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 mt-6">
            <h3 className="text-sm font-bold text-slate-900 mb-2">Current operational workflows</h3>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              Staff currently monitor and transition orders through the standard back-office order
              queue.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/admin/orders"
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition"
              >
                View orders queue &rarr;
              </Link>
              <Link
                href="/admin"
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
              >
                Back to overview
              </Link>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
