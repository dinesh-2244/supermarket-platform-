import Link from 'next/link';
import { requirePrincipal } from '@/auth';
import { listStores } from '@/modules/stores';
import { adminHref, formatPaise, orderQueue, resolveStoreId } from '@/modules/admin';
import type { QueueRow } from '@/modules/orders';
import { Card, Empty, OrderStatusBadge, PageHeading, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * The back-office order queue (AD4).
 *
 * Store-scoped twice over: resolveStoreId validates assignment, and orders applies
 * allowedStoreIds filter in the query itself.
 * Features status filtering, visual badges, and tablet-first staff readability.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const stores = await listStores(principal);
  const storeId = resolveStoreId(
    principal,
    typeof params.store === 'string' ? params.store : undefined,
    stores,
  );

  if (storeId === null) {
    return (
      <div className="space-y-6">
        <PageHeading title="Orders" />
        <Empty title="No Store Assigned">You are not assigned to a store.</Empty>
      </div>
    );
  }

  const all = params.all === '1';
  const queue = await orderQueue(principal, storeId, { all });
  const timeZone = stores.find((store) => store.id === storeId)?.timezone ?? 'Asia/Kolkata';

  return (
    <div className="space-y-6">
      <PageHeading
        title="Orders"
        subtitle={
          all
            ? 'Complete order history for this store.'
            : 'Orders currently requiring action. Delivered and cancelled orders are hidden.'
        }
      />

      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/orders" />

      {/* Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={adminHref('/admin/orders', storeId)}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition shadow-2xs ${
            !all
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <span>Actionable orders</span>
          {!all ? (
            <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs text-white">
              {queue.rows.length}
            </span>
          ) : null}
        </Link>
        <Link
          href={adminHref('/admin/orders?all=1', storeId)}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition shadow-2xs ${
            all
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <span>All orders</span>
          {all ? (
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-white">
              {queue.rows.length}
            </span>
          ) : null}
        </Link>
      </div>

      <Card>
        {queue.rows.length === 0 ? (
          <Empty title={all ? 'No orders in store history' : 'All clear'}>
            {all
              ? 'This shop has no orders yet.'
              : 'No orders require action right now. Check "All orders" for completed orders.'}
          </Empty>
        ) : (
          <Table
            head={[
              'Order number',
              'Placed',
              'Delivery window',
              'Status',
              'Total',
              'Variance',
              'Actions',
            ]}
          >
            {queue.rows.map((row) => (
              <Row key={row.id} row={row} timeZone={timeZone} storeId={storeId} />
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

function Row({
  row,
  timeZone,
  storeId,
}: {
  row: QueueRow;
  timeZone: string;
  storeId: string;
}): React.ReactElement {
  return (
    <tr className="hover:bg-slate-50/60 transition align-top">
      <td className="py-3 px-4">
        <Link
          href={adminHref(`/admin/orders/${row.id}`, storeId)}
          className="inline-flex min-h-[44px] flex-col justify-center font-bold text-emerald-800 hover:text-emerald-950"
        >
          <span className="font-mono text-sm underline">{row.orderNumber}</span>
          <span className="text-xs text-slate-500 font-medium">{row.contactNameSnapshot}</span>
        </Link>
      </td>
      <td className="py-3 px-4 text-xs font-medium text-slate-600">
        {when(row.placedAt, timeZone)}
      </td>
      <td className="py-3 px-4 text-xs font-medium text-slate-600">
        <div>{when(row.deliverySlotStart, timeZone)}</div>
        <div className="text-slate-400">&rarr; {clock(row.deliverySlotEnd, timeZone)}</div>
      </td>
      <td className="py-3 px-4">
        <OrderStatusBadge status={row.status} />
      </td>
      <td className="py-3 px-4 font-bold text-slate-900">{formatPaise(row.estimatedTotalPaise)}</td>
      <td className="py-3 px-4">
        {row.priceVarianceFlagged ? (
          <span className="inline-flex items-center rounded-full bg-amber-100 border border-amber-300 px-2.5 py-0.5 text-xs font-bold text-amber-900">
            variance flagged
          </span>
        ) : (
          <span className="text-xs text-slate-400">&mdash;</span>
        )}
      </td>
      <td className="py-3 px-4">
        <Link
          href={adminHref(`/admin/orders/${row.id}`, storeId)}
          className="inline-flex min-h-[44px] items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-[0.99] transition"
        >
          View details &rarr;
        </Link>
      </td>
    </tr>
  );
}

/** Every time in the back office is the shop's time, not the reader's. */
function when(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}

function clock(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
}
