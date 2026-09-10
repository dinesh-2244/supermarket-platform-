import Link from 'next/link';
import { requirePrincipal } from '@/auth';
import { listStores } from '@/modules/stores';
import { formatPaise, orderQueue, resolveStoreId } from '@/modules/admin';
import type { QueueRow } from '@/modules/orders';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * The back-office order queue (D6).
 *
 * Store-scoped twice over: `resolveStoreId` will not hand a staff member a store
 * they are not assigned to, and `orders` applies the `allowedStoreIds` filter in
 * the query itself. Neither is decoration — the first stops the wrong store
 * being *asked for*, the second stops it being *returned* if someone later drops
 * the first.
 *
 * Defaults to what the store still has to act on. Delivered, closed and
 * cancelled orders are history and would bury the work, so they are behind
 * `?all=1` rather than absent.
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
      <>
        <PageHeading title="Orders" />
        <Empty>You are not assigned to a store.</Empty>
      </>
    );
  }

  const all = params.all === '1';
  const queue = await orderQueue(principal, storeId, { all });
  const timeZone = stores.find((store) => store.id === storeId)?.timezone ?? 'Asia/Kolkata';

  return (
    <>
      <PageHeading
        title="Orders"
        subtitle={
          all
            ? 'Every order this shop has taken.'
            : 'Orders this shop still has to act on. Delivered and cancelled orders are hidden.'
        }
      />
      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/orders" />

      <Card>
        <p className="mb-3 text-sm">
          <Link
            href={`/admin/orders?store=${storeId}${all ? '' : '&all=1'}`}
            className="text-emerald-800 underline"
          >
            {all ? 'Show only orders needing action' : 'Show every order'}
          </Link>
        </p>

        {queue.rows.length === 0 ? (
          <Empty>{all ? 'This shop has no orders yet.' : 'Nothing needs action right now.'}</Empty>
        ) : (
          <Table head={['Order', 'Placed', 'Delivery window', 'Status', 'Total', 'Variance']}>
            {queue.rows.map((row) => (
              <Row key={row.id} row={row} timeZone={timeZone} />
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

function Row({ row, timeZone }: { row: QueueRow; timeZone: string }): React.ReactElement {
  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="py-2 pr-3">
        <Link href={`/admin/orders/${row.id}`} className="text-emerald-800 underline">
          {row.orderNumber}
        </Link>
        <div className="text-xs text-slate-500">{row.contactNameSnapshot}</div>
      </td>
      <td className="py-2 pr-3 text-xs text-slate-600">{when(row.placedAt, timeZone)}</td>
      <td className="py-2 pr-3 text-xs text-slate-600">
        {when(row.deliverySlotStart, timeZone)} – {clock(row.deliverySlotEnd, timeZone)}
      </td>
      <td className="py-2 pr-3">{row.status}</td>
      <td className="py-2 pr-3">{formatPaise(row.estimatedTotalPaise)}</td>
      <td className="py-2 pr-3">
        {row.priceVarianceFlagged ? (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">flagged</span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        )}
      </td>
    </tr>
  );
}

/** Every time in the back office is the **shop's** time, not the reader's. */
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
