import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePrincipal } from '@/auth';
import { formatPaise, orderDetail } from '@/modules/admin';
import { canCancelByStore, requiresDiscrepancyNote, type StaffOrderRow } from '@/modules/orders';
import { cancelOrderAction, confirmRevisedAmountAction } from '../../actions';
import { ActionForm, Field, Hidden } from '../../form';
import { Card, Empty, PageHeading, Table } from '../../ui';

export const dynamic = 'force-dynamic';

/**
 * One order, for staff (D6).
 *
 * A wrong-store id is a **404**, not a 403: `orderDetail` scopes the read to the
 * principal's stores, so an order that is not theirs simply does not exist as
 far as this page is concerned. Telling somebody an order exists but is not
 * theirs is itself a disclosure, and there is nothing they could do with it.
 *
 * The two write affordances below are rendered from what the domain says, not
 * from the role: `canCancelByStore` decides whether the correction is offered at
 * all, and the service re-checks `order:cancel` regardless — so a staff member
 * who reaches the action by other means is refused by the grant table rather
 * than by a hidden button.
 */
export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>;
}): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const { orderId } = await params;
  const order = await orderDetail(principal, orderId);
  if (order === null) notFound();

  const zone = order.store.timezone;
  const cancellable = canCancelByStore(order.status);
  const needsNote = requiresDiscrepancyNote(order.status);
  const restoredAlready = order.lines.reduce((sum, line) => sum + line.stockRestoredQty, 0);

  return (
    <>
      <PageHeading
        title={`Order ${order.orderNumber}`}
        subtitle={`${order.store.name} · ${order.status}`}
      />
      <p className="mb-4 text-sm">
        <Link href="/admin/orders" className="text-emerald-800 underline">
          Back to the queue
        </Link>
      </p>

      <Card title="Order">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row label="Placed" value={when(order.placedAt, zone)} />
          <Row
            label="Delivery window"
            value={`${when(order.deliverySlotStart, zone)} – ${clock(order.deliverySlotEnd, zone)}`}
          />
          <Row
            label="Payment"
            value={order.paymentMethod === 'COD' ? 'Cash on delivery' : 'UPI on delivery'}
          />
          <Row label="Customer" value={order.contactNameSnapshot} />
          <Row label="Phone" value={order.contactPhoneSnapshot} />
          <Row label="Delivering to" value={locality(order.deliveryAddressSnapshotJson)} />
        </dl>
      </Card>

      <Card title="Lines">
        <Table head={['Item', 'Ordered', 'Picked', 'Restored', 'Unit', 'Line']}>
          {order.lines.map((line) => (
            <tr key={line.id} className="border-b border-slate-100">
              <td className="py-2 pr-3">
                {line.nameSnapshot}
                <div className="text-xs text-slate-500">{line.packSizeSnapshot}</div>
              </td>
              <td className="py-2 pr-3">{line.qtyOrdered}</td>
              <td className="py-2 pr-3">{line.qtyPicked ?? '—'}</td>
              <td className="py-2 pr-3">{line.stockRestoredQty}</td>
              <td className="py-2 pr-3">{formatPaise(line.unitPricePaise)}</td>
              <td className="py-2 pr-3">{formatPaise(line.unitPricePaise * line.qtyOrdered)}</td>
            </tr>
          ))}
        </Table>

        <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <Row label="Subtotal" value={formatPaise(order.subtotalPaise)} />
          <Row label="Delivery" value={formatPaise(order.deliveryFeePaise)} />
          <Row label="Estimated total" value={formatPaise(order.estimatedTotalPaise)} />
          {order.posFinalTotalPaise === null ? null : (
            <Row label="POS total" value={formatPaise(order.posFinalTotalPaise)} />
          )}
        </dl>
      </Card>

      <Card title="Price variance">
        {order.priceVarianceFlagged ? (
          <>
            <p
              role="status"
              className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              The billed total is over this shop’s tolerance. This order cannot leave PACKED until
              the customer has confirmed the revised amount.
            </p>
            {order.customerConfirmedRevisedAmount ? (
              <p className="text-sm text-slate-600">
                Confirmed with the customer. The order can go out.
              </p>
            ) : (
              <ActionForm action={confirmRevisedAmountAction} submitLabel="Customer has confirmed">
                <Hidden name="orderId" value={order.id} />
              </ActionForm>
            )}
          </>
        ) : (
          <Empty>No price variance. Nothing to confirm.</Empty>
        )}
      </Card>

      <Card title="Status history">
        <Table head={['From', 'To', 'By', 'When', 'Note']}>
          {order.statusHistory.map((entry, index) => (
            <tr key={`${entry.toStatus}-${index}`} className="border-b border-slate-100 align-top">
              <td className="py-2 pr-3 text-xs">{entry.fromStatus ?? '—'}</td>
              <td className="py-2 pr-3">{entry.toStatus}</td>
              <td className="py-2 pr-3 text-xs">{entry.actorType}</td>
              <td className="py-2 pr-3 text-xs text-slate-600">{when(entry.createdAt, zone)}</td>
              <td className="py-2 pr-3 text-xs text-slate-600">{entry.note ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Cancel this order">
        {cancellable ? (
          <>
            <p className="mb-3 text-sm text-slate-600">
              Cancelling gives every not-yet-restored unit back to website stock, with an
              <code className="mx-1">ADMIN_CORRECTION</code> ledger row, and writes an audit entry.
              {restoredAlready > 0
                ? ` ${String(restoredAlready)} unit(s) have already been restored and will not be restored again.`
                : ''}{' '}
              There is no customer-facing cancellation; this is the only way an order ends early.
            </p>
            <ActionForm action={cancelOrderAction} submitLabel="Cancel order">
              <Hidden name="orderId" value={order.id} />
              <Field label="Reason" name="reason" required />
              {needsNote ? (
                <Field label="How the POS bill was voided" name="discrepancyNote" required />
              ) : null}
            </ActionForm>
          </>
        ) : order.status === 'CANCELLED_BY_STORE' ? (
          <>
            <p
              role="status"
              className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              Cancelled by the shop.
              {order.correctionReason === null ? '' : ` Reason: ${order.correctionReason}`}
            </p>
            {/* D6 asks for the restored quantities to be visible *afterwards*.
                Read from `stockRestoredQty` rather than from the action's reply,
                because that message disappears with the form that produced it —
                and a manager who reloads the page still needs the answer. */}
            <p className="mt-2 text-sm text-slate-600">
              {restoredAlready > 0
                ? `Restored ${String(restoredAlready)} unit(s) to website stock across ${String(
                    order.lines.filter((line) => line.stockRestoredQty > 0).length,
                  )} line(s) — see the Restored column above.`
                : 'No stock needed restoring.'}
            </p>
          </>
        ) : (
          <Empty>This order is {order.status} and can no longer be cancelled by the shop.</Empty>
        )}
      </Card>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex flex-wrap justify-between gap-2 sm:block">
      <dt className="text-slate-500">{label}</dt>
      <dd>{value}</dd>
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
