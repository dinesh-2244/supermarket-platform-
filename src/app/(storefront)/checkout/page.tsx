import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { viewCart } from '@/modules/cart';
import { availableSlots } from '@/modules/checkout';
import { getStore, listServiceableAreas } from '@/modules/stores';
import { currentCartToken, currentStorefrontPrincipal, storefrontPrincipal } from '@/storefront';
import { ActionForm, Field } from '../form';
import { rupees, Card, Empty, PageHeading } from '../ui';
import { placeOrderAction } from './actions';

export const metadata: Metadata = {
  title: 'Checkout',
  description: 'Confirm where and when, and place your order.',
};

/**
 * Checkout (D4). No login required — an account is a convenience, never a gate.
 *
 * Everything on this page is a *display* of what the server already decided:
 * the lines and totals come from a fresh revalidation, the slots from the same
 * grid `placeOrder` validates against. A shopper who edits the HTML changes what
 * they see and nothing about what the server will accept.
 */
export default async function CheckoutPage(): Promise<React.ReactElement> {
  const { context, customer } = await currentStorefrontPrincipal();
  if (context === null) redirect('/locality');

  const cartToken = await currentCartToken();
  const principal = storefrontPrincipal(context, customer?.id ?? null);
  const cart = cartToken === null ? null : await viewCart(principal, cartToken);

  if (cart === null || cart.lines.length === 0) {
    return (
      <>
        <PageHeading title="Checkout" />
        <Card>
          <Empty>Your basket is empty, so there is nothing to check out.</Empty>
          <p className="text-center text-sm">
            <Link href="/" className="text-emerald-800 underline">
              Start shopping
            </Link>
          </p>
        </Card>
      </>
    );
  }

  const { totals } = cart;
  const storeId = context.serviceability.storeId;
  const [slots, areas, store] = await Promise.all([
    availableSlots(principal, storeId, new Date()),
    listServiceableAreas(),
    getStore(principal, storeId),
  ]);
  const areasHere = areas.filter((area) => area.storeId === storeId);
  const bookable = slots.filter((slot) => slot.capacityRemaining > 0);

  const belowMinimum = !totals.meetsMinimum;
  const estimatedTotal = totals.subtotalPaise + totals.deliveryFeePaise;

  return (
    <>
      <PageHeading
        title="Checkout"
        subtitle="No account needed. You pay when your order is delivered."
      />

      <Card title="Your order">
        <ul className="divide-y divide-slate-100">
          {cart.lines.map((line) => (
            <li key={line.productId} className="flex justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                {line.name}
                <span className="text-slate-500">
                  {' '}
                  · {line.packSize} × {line.qty}
                </span>
              </span>
              <span className="shrink-0 font-medium">{rupees(line.lineTotalPaise)}</span>
            </li>
          ))}
        </ul>

        <dl className="mt-3 space-y-1 border-t border-slate-200 pt-3 text-sm">
          <Row label="Subtotal" value={rupees(totals.subtotalPaise)} />
          <Row label="Delivery" value={rupees(totals.deliveryFeePaise)} />
          <Row label="Estimated total" value={rupees(estimatedTotal)} strong />
        </dl>

        {/* R6, said before the order rather than after the bill. */}
        <p className="mt-2 text-xs text-slate-600">
          This is an <strong>estimated total</strong>. The final amount is confirmed when the shop
          bills your order, and weighed items can differ slightly.
        </p>

        {belowMinimum ? (
          <p
            role="status"
            className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            This shop’s minimum order is {rupees(totals.minOrderPaise)}. Add a little more to
            continue.
          </p>
        ) : null}
      </Card>

      {bookable.length === 0 ? (
        <Card title="Delivery">
          <Empty>
            There are no delivery windows available at the moment. Please try again later.
          </Empty>
        </Card>
      ) : (
        <Card title="Where and when">
          <ActionForm
            action={placeOrderAction}
            submitLabel="Place order"
            pendingLabel="Placing your order…"
            className="space-y-4"
          >
            <div className="flex flex-wrap gap-3">
              <Field
                label="Your name"
                name="name"
                defaultValue={customer?.name ?? ''}
                maxLength={120}
              />
              <Field
                label="Phone number"
                name="phone"
                type="tel"
                defaultValue={customer?.phone ?? ''}
                maxLength={20}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <Field label="Address line 1" name="line1" maxLength={200} />
              <Field label="Address line 2 (optional)" name="line2" maxLength={200} />
            </div>

            <label className="block text-xs text-slate-600">
              <span className="mb-1 block">Delivery area</span>
              <select
                name="areaId"
                defaultValue={context.areaId}
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 sm:w-72"
              >
                {areasHere.map((area) => (
                  <option key={area.areaId} value={area.areaId}>
                    {area.areaName}
                    {area.pincode === null ? '' : ` · ${area.pincode}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs text-slate-600">
              <span className="mb-1 block">Delivery window</span>
              <select
                name="slotStart"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900 sm:w-72"
              >
                {bookable.map((slot) => (
                  <option key={slot.start.toISOString()} value={slot.start.toISOString()}>
                    {slotLabel(slot.start, slot.end, store.timezone)}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="text-xs text-slate-600">
              <legend className="mb-1">How you will pay on delivery</legend>
              <label className="mr-4 inline-flex items-center gap-2 text-sm text-slate-900">
                <input type="radio" name="paymentMethod" value="COD" defaultChecked />
                Cash on delivery
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-slate-900">
                <input type="radio" name="paymentMethod" value="UPI_ON_DELIVERY" />
                UPI on delivery
              </label>
            </fieldset>
          </ActionForm>
        </Card>
      )}
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
    <div className={`flex justify-between ${strong === true ? 'font-semibold' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/**
 * "Tue 2 Dec, 10:00 – 11:00", in the **shop's** timezone.
 *
 * Rendered on the server, from `Store.timezone`, so the window a shopper reads
 * is the window the shop will deliver in — not the one their phone's timezone
 * happens to name. A traveller browsing from another country must not be shown a
 * different hour than the rider will arrive at.
 */
export function slotLabel(start: Date, end: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat('en-IN', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(start);
  const time = (at: Date): string =>
    new Intl.DateTimeFormat('en-IN', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(at);
  return `${day}, ${time(start)} – ${time(end)}`;
}
