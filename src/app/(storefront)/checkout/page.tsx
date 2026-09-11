import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { viewCart } from '@/modules/cart';
import { availableSlots } from '@/modules/checkout';
import { getStore } from '@/modules/stores';
import { currentCartToken, currentStorefrontPrincipal, storefrontPrincipal } from '@/storefront';
import { listAddresses } from '@/modules/customers';
import { ActionForm, Field } from '../form';
import { rupees, Card, Empty, PageHeading } from '../ui';
import { placeOrderAction } from './actions';
import { blockingIssues, LineIssues, RevalidationNotices } from './notices';
import { communityNameForStore } from '../communities';

export const metadata: Metadata = {
  title: 'Checkout | Munder Fresh',
  description: 'Confirm your delivery address, select a delivery window, and place your order.',
};

/**
 * Checkout (D4, D6). No account required.
 *
 * Scoped directly to the selected community:
 * - Address entry tailored for Apartment/House No. and Block/Street
 * - NO confusing large locality dropdown
 * - Preserves server-authoritative pricing and single-transaction slot allocation
 */
export default async function CheckoutPage(): Promise<React.ReactElement> {
  const { context, customer } = await currentStorefrontPrincipal();
  if (context === null) redirect('/store/select');

  const cartToken = await currentCartToken();
  const principal = storefrontPrincipal(context, customer?.id ?? null);
  const cart = cartToken === null ? null : await viewCart(principal, cartToken);

  if (cart === null || cart.lines.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeading title="Checkout" />
        {cart === null ? null : <RevalidationNotices notice={cart.notice} removed={cart.removed} />}
        <Card>
          <Empty>Your basket is empty, so there is nothing to check out.</Empty>
          <p className="text-center text-sm mt-4">
            <Link
              href="/"
              className="font-semibold text-emerald-800 underline hover:text-emerald-900"
            >
              Start shopping →
            </Link>
          </p>
        </Card>
      </div>
    );
  }

  const { totals } = cart;
  const storeId = context.serviceability.storeId;
  const [slots, store] = await Promise.all([
    availableSlots(principal, storeId, new Date()),
    getStore(principal, storeId),
  ]);

  const bookable = slots.filter((slot) => slot.capacityRemaining > 0);
  const belowMinimum = !totals.meetsMinimum;
  const estimatedTotal = totals.subtotalPaise + totals.deliveryFeePaise;
  const blocked = blockingIssues(cart.lines);
  const communityName = communityNameForStore(store.id, store.name);

  // Scoped to the signed-in customer by listAddresses
  const addresses = customer === null ? [] : await listAddresses(principal);
  const preferred = addresses.find((address) => address.isDefault) ?? addresses[0] ?? null;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeading
        title="Checkout"
        subtitle="No account needed. You pay when your order is delivered."
      />

      <RevalidationNotices notice={cart.notice} removed={cart.removed} />

      {/* Order Summary Card */}
      <Card title="Your Order Summary">
        <ul className="divide-y divide-slate-100">
          {cart.lines.map((line) => (
            <li key={line.productId} className="flex justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                <span className="font-medium text-slate-900">{line.name}</span>
                <span className="text-slate-500">
                  {' '}
                  · {line.packSize} × {line.qty}
                </span>
                <LineIssues line={line} />
              </span>
              <span className="shrink-0 font-bold text-slate-900">
                {rupees(line.lineTotalPaise)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-4 space-y-1.5 border-t border-slate-200 pt-3 text-sm">
          <Row label="Subtotal" value={rupees(totals.subtotalPaise)} />
          <Row label="Delivery" value={rupees(totals.deliveryFeePaise)} />
          <Row label="Estimated total" value={rupees(estimatedTotal)} strong />
        </dl>

        <p className="mt-3 text-xs text-slate-500 leading-relaxed">
          This is an <strong>estimated total</strong>. The final amount is confirmed when the shop
          bills your order, and weighed items can differ slightly.
        </p>

        {belowMinimum ? (
          <p
            role="status"
            className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs font-semibold text-amber-900"
          >
            This shop’s minimum order is {rupees(totals.minOrderPaise)}. Add a little more to
            continue.
          </p>
        ) : null}
      </Card>

      {/* Delivery Details Card (D6) */}
      {blocked.length > 0 ? (
        <Card title="Where and when">
          <p
            role="status"
            className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            Some items are no longer available in the quantity you asked for. Adjust them in{' '}
            <Link href="/cart" className="underline font-semibold">
              your basket
            </Link>{' '}
            and come back.
          </p>
        </Card>
      ) : bookable.length === 0 ? (
        <Card title="Delivery">
          <Empty>
            There are no delivery windows available at the moment. Please try again later.
          </Empty>
        </Card>
      ) : (
        <Card title="Delivery Address & Window">
          <ActionForm
            action={placeOrderAction}
            submitLabel="Place order"
            pendingLabel="Placing your order…"
            className="space-y-4"
          >
            {/* Gated Community Locked Indicator (D6) */}
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-slate-700">
              <div className="flex items-center justify-between">
                <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                  Delivering to Community
                </span>
                <Link
                  href="/store/select"
                  className="text-xs font-semibold text-emerald-800 hover:underline"
                >
                  Change
                </Link>
              </div>
              <label className="mt-1 block">
                <span className="sr-only">Delivery area</span>
                <input
                  type="text"
                  name="deliveryAreaDisplay"
                  aria-label="Delivery area"
                  readOnly
                  value={communityName}
                  className="w-full bg-transparent font-bold text-sm text-slate-900 focus:outline-none cursor-default"
                />
              </label>
              <input type="hidden" name="areaId" value={preferred?.areaId ?? context.areaId} />
            </div>

            {/* Recipient Contact */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Your name"
                name="name"
                defaultValue={customer?.name ?? ''}
                placeholder="Full name"
                maxLength={120}
              />
              <Field
                label="Phone number"
                name="phone"
                type="tel"
                defaultValue={customer?.phone ?? ''}
                placeholder="10-digit mobile number"
                maxLength={20}
              />
            </div>

            {/* Address Inputs */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Address line 1"
                name="line1"
                defaultValue={preferred?.line1 ?? ''}
                placeholder="House / Flat / Quarter No. (e.g. Flat 202 or Qtr 14/B)"
                maxLength={200}
              />
              <Field
                label="Address line 2 (optional)"
                name="line2"
                defaultValue={preferred?.line2 ?? ''}
                placeholder="Block / Street / Landmark (e.g. Block 4, Near Main Gate)"
                maxLength={200}
              />
            </div>

            {/* Delivery Window Selector */}
            <label className="block text-xs font-medium text-slate-700">
              <span className="mb-1 block">Delivery window</span>
              <select
                name="slotStart"
                className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none min-h-[44px]"
              >
                {bookable.map((slot) => (
                  <option key={slot.start.toISOString()} value={slot.start.toISOString()}>
                    {slotLabel(slot.start, slot.end, store.timezone)}
                  </option>
                ))}
              </select>
            </label>

            {/* Payment Method */}
            <fieldset className="rounded-xl border border-slate-200 p-4 text-xs text-slate-600">
              <legend className="font-semibold text-slate-800 px-1">Payment on Delivery</legend>
              <div className="mt-2 flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-sm text-slate-900 cursor-pointer min-h-[44px]">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="COD"
                    defaultChecked
                    className="h-4 w-4 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>💵 Cash on delivery</span>
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-slate-900 cursor-pointer min-h-[44px]">
                  <input
                    type="radio"
                    name="paymentMethod"
                    value="UPI_ON_DELIVERY"
                    className="h-4 w-4 text-emerald-700 focus:ring-emerald-600"
                  />
                  <span>📱 UPI on delivery (GPay / PhonePe / Paytm)</span>
                </label>
              </div>
            </fieldset>
          </ActionForm>
        </Card>
      )}
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
    <div
      className={`flex justify-between ${strong === true ? 'font-bold text-slate-900 text-base' : 'text-slate-600'}`}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

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
