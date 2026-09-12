import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/auth';
import { formatPaise, orderDetail } from '@/modules/admin';
import { canCancelByStore, requiresDiscrepancyNote, type StaffOrderRow } from '@/modules/orders';
import { cancelOrderAction, confirmRevisedAmountAction } from '../../actions';
import { ActionForm, Field, Hidden } from '../../form';
import { Card, Empty, OrderStatusBadge, PageHeading, Table } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * One order detail and audit view for back-office staff (AD4).
 * Scoped to staff's assigned store(s); non-permitted orders return notFound().
 */
export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<{ store?: string }>;
}): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const { orderId } = await params;
  const resolvedSearchParams = await searchParams;
  const order = await orderDetail(principal, orderId);
  if (order === null) notFound();

  const currentStore = resolvedSearchParams?.store ?? order.storeId;
  const zone = order.store.timezone;
  const cancellable = canCancelByStore(order.status);
  const needsNote = requiresDiscrepancyNote(order.status);
  const restoredAlready = order.lines.reduce((sum, line) => sum + line.stockRestoredQty, 0);

  return (
    <div className="space-y-6">
      <PageHeading
        title={`Order ${order.orderNumber}`}
        subtitle={`${order.store.name} · Placed ${when(order.placedAt, zone)}`}
        badge={<OrderStatusBadge status={order.status} />}
        action={
          <Link
            href={`/admin/orders?store=${currentStore}`}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-2xs hover:bg-slate-50 active:scale-[0.99] transition"
          >
            &larr; Back to queue
          </Link>
        }
      />

      {/* Order Overview DL */}
      <Card title="Order details">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <DetailRow label="Placed at" value={when(order.placedAt, zone)} />
          <DetailRow
            label="Delivery window"
            value={`${when(order.deliverySlotStart, zone)} – ${clock(order.deliverySlotEnd, zone)}`}
          />
          <DetailRow
            label="Payment method"
            value={order.paymentMethod === 'COD' ? 'Cash on delivery' : 'UPI on delivery'}
          />
          <DetailRow label="Customer name" value={order.contactNameSnapshot} />
          <DetailRow label="Phone number" value={order.contactPhoneSnapshot} />
          <DetailRow label="Delivering to" value={locality(order.deliveryAddressSnapshotJson)} />
        </dl>
      </Card>

      {/* Order Items Table */}
      <Card title="Ordered items">
        <Table head={['Item', 'Ordered', 'Picked', 'Restored', 'Unit price', 'Line total']}>
          {order.lines.map((line) => (
            <tr key={line.id} className="hover:bg-slate-50/60 transition">
              <td className="py-3 px-4">
                <span className="font-bold text-slate-900">{line.nameSnapshot}</span>
                <div className="text-xs text-slate-500">{line.packSizeSnapshot}</div>
              </td>
              <td className="py-3 px-4 font-semibold">{line.qtyOrdered}</td>
              <td className="py-3 px-4">{line.qtyPicked ?? '—'}</td>
              <td className="py-3 px-4">
                {line.stockRestoredQty > 0 ? (
                  <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-900">
                    {line.stockRestoredQty} restored
                  </span>
                ) : (
                  '0'
                )}
              </td>
              <td className="py-3 px-4 font-medium">{formatPaise(line.unitPricePaise)}</td>
              <td className="py-3 px-4 font-bold text-slate-900">
                {formatPaise(line.unitPricePaise * line.qtyOrdered)}
              </td>
            </tr>
          ))}
        </Table>

        <div className="mt-5 rounded-2xl bg-slate-50 border border-slate-200/80 p-5">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between text-slate-600">
              <dt>Subtotal</dt>
              <dd className="font-semibold">{formatPaise(order.subtotalPaise)}</dd>
            </div>
            <div className="flex justify-between text-slate-600">
              <dt>Delivery fee</dt>
              <dd className="font-semibold">{formatPaise(order.deliveryFeePaise)}</dd>
            </div>
            {order.posFinalTotalPaise !== null ? (
              <div className="flex justify-between text-slate-600">
                <dt>POS billed total</dt>
                <dd className="font-semibold">{formatPaise(order.posFinalTotalPaise)}</dd>
              </div>
            ) : null}
            <div className="border-t border-slate-200 pt-3 flex justify-between items-baseline text-slate-900">
              <dt className="font-bold">Estimated total</dt>
              <dd className="text-xl font-black">{formatPaise(order.estimatedTotalPaise)}</dd>
            </div>
          </dl>
        </div>
      </Card>

      {/* Price Variance Handling */}
      <Card title="Price variance">
        {order.priceVarianceFlagged ? (
          <div className="space-y-4">
            <div
              role="status"
              className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-950 flex items-start gap-3"
            >
              <span className="text-amber-700 text-lg leading-none">&excl;</span>
              <p>
                The billed total is over this shop’s tolerance. This order cannot leave PACKED until
                the customer has confirmed the revised amount.
              </p>
            </div>
            {order.customerConfirmedRevisedAmount ? (
              <p className="text-sm font-bold text-emerald-800">
                &check; Confirmed with the customer. The order can go out.
              </p>
            ) : (
              <ActionForm action={confirmRevisedAmountAction} submitLabel="Customer has confirmed">
                <Hidden name="orderId" value={order.id} />
              </ActionForm>
            )}
          </div>
        ) : (
          <Empty title="No price variance">No price variance detected. Nothing to confirm.</Empty>
        )}
      </Card>

      {/* Status History */}
      <Card title="Status history">
        <Table head={['From status', 'To status', 'Actor type', 'Timestamp', 'Note']}>
          {order.statusHistory.map((entry, index) => (
            <tr key={`${entry.toStatus}-${index}`} className="hover:bg-slate-50/60 transition">
              <td className="py-3 px-4 text-xs font-mono text-slate-500">
                {entry.fromStatus ?? '—'}
              </td>
              <td className="py-3 px-4">
                <OrderStatusBadge status={entry.toStatus} />
              </td>
              <td className="py-3 px-4 text-xs font-semibold text-slate-600">{entry.actorType}</td>
              <td className="py-3 px-4 text-xs font-mono text-slate-500">
                {when(entry.createdAt, zone)}
              </td>
              <td className="py-3 px-4 text-xs text-slate-600 font-medium">{entry.note ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>

      {/* Cancellation and Corrections */}
      <Card title="Cancel this order">
        {cancellable ? (
          <div className="space-y-4">
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Cancelling gives every not-yet-restored unit back to website stock with an{' '}
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800">
                ADMIN_CORRECTION
              </code>{' '}
              ledger row and writes an audit entry.
              {restoredAlready > 0
                ? ` ${String(restoredAlready)} unit(s) have already been restored and will not be restored again.`
                : ''}{' '}
              There is no customer-facing cancellation; this is the only way an order ends early.
            </p>
            <ActionForm
              action={cancelOrderAction}
              submitLabel="Cancel order"
              submitButtonClassName="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-rose-700 px-5 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-rose-800 transition active:scale-[0.99] disabled:opacity-50"
            >
              <Hidden name="orderId" value={order.id} />
              <Field label="Reason" name="reason" required width="w-64" />
              {needsNote ? (
                <Field
                  label="How the POS bill was voided"
                  name="discrepancyNote"
                  required
                  width="w-64"
                />
              ) : null}
            </ActionForm>
          </div>
        ) : order.status === 'CANCELLED_BY_STORE' ? (
          <div className="space-y-3">
            <div
              role="status"
              className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-900"
            >
              Cancelled by the shop.
              {order.correctionReason === null ? '' : ` Reason: ${order.correctionReason}`}
            </div>
            <p className="text-xs sm:text-sm text-slate-600">
              {restoredAlready > 0
                ? `Restored ${String(restoredAlready)} unit(s) to website stock across ${String(
                    order.lines.filter((line) => line.stockRestoredQty > 0).length,
                  )} line(s) — see the Restored column above.`
                : 'No stock needed restoring.'}
            </p>
          </div>
        ) : (
          <Empty title="Order cannot be cancelled">
            This order is {order.status} and can no longer be cancelled by the shop.
          </Empty>
        )}
      </Card>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <dt className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function locality(snapshot: StaffOrderRow['deliveryAddressSnapshotJson']): string {
  if (typeof snapshot !== 'object' || snapshot === null) return '—';
  const record = snapshot as Record<string, unknown>;
  const parts = [record.line1, record.line2, record.locality, record.pincode]
    .filter((part): part is string => typeof part === 'string' && part.length > 0)
    .join(', ');
  return parts === '' ? '—' : parts;
}

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
