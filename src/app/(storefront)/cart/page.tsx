import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MAX_LINE_QUANTITY, viewCart, type CartLine, type LineIssue } from '@/modules/cart';
import { currentCartToken, currentStoreContext, storefrontPrincipal } from '@/storefront';
import { removeFromCartAction, setCartQuantityAction } from '../cart-actions';
import { ActionForm } from '../form';
import { rupees, Card, Empty, PageHeading } from '../ui';

export const metadata: Metadata = {
  title: 'Your basket',
  description: 'What you have chosen, priced by the shop that delivers to you.',
};

/**
 * The basket (D4).
 *
 * Loading this page **revalidates** it: prices, listings and stock are re-read
 * from the store, changes are surfaced, and delisted items are taken out. The
 * numbers below are therefore the store's, not the ones the shopper last saw —
 * which is the entire guarantee the cart makes.
 */
export default async function CartPage(): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  if (context === null) redirect('/locality');

  const cartToken = await currentCartToken();
  const cart = cartToken === null ? null : await viewCart(storefrontPrincipal(context), cartToken);

  if (cart === null || cart.lines.length === 0) {
    return (
      <>
        <PageHeading title="Your basket" />
        <Card>
          <Empty>Your basket is empty.</Empty>
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

  return (
    <>
      <PageHeading
        title="Your basket"
        subtitle="Prices and availability are checked against the shop every time you look."
      />

      {cart.removed.length === 0 ? null : (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          We had to take {cart.removed.length === 1 ? 'an item' : 'some items'} out:{' '}
          {cart.removed
            .map(
              (row) =>
                `${row.name} (${row.reason === 'unlisted' ? 'no longer sold here' : 'discontinued'})`,
            )
            .join(', ')}
          .
        </p>
      )}

      <Card>
        <ul className="flex flex-col divide-y divide-slate-100">
          {cart.lines.map((line) => (
            <li key={line.productId} className="py-3 first:pt-0 last:pb-0">
              <CartRow line={line} />
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Total">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal ({String(totals.itemCount)} item(s))</dt>
            <dd className="font-semibold">{rupees(totals.subtotalPaise)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>Delivery</dt>
            <dd>{rupees(totals.deliveryFeePaise)}</dd>
          </div>
          <div className="flex justify-between text-slate-600">
            <dt>Minimum order</dt>
            <dd>{rupees(totals.minOrderPaise)}</dd>
          </div>
        </dl>

        {totals.meetsMinimum ? null : (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Add {rupees(totals.minOrderPaise - totals.subtotalPaise)} more to reach the minimum
            order for your area.
          </p>
        )}

        <div className="mt-4">
          {/* No checkout in Phase 3: no route, no order, no stock movement.
              The control is here, visibly disabled, so the page is honest about
              where it stops rather than pretending the feature is missing. */}
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="w-full rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50 sm:w-auto"
          >
            Proceed to checkout
          </button>
          <p className="mt-2 text-xs text-slate-500">Checkout arrives in Phase 4.</p>
        </div>
      </Card>
    </>
  );
}

function CartRow({ line }: { line: CartLine }): React.ReactElement {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 grow">
        <Link href={`/p/${line.slug}`} className="text-sm font-medium hover:underline">
          {line.name}
        </Link>
        <p className="mt-0.5 text-xs text-slate-500">
          {line.brand === null ? null : <span>{line.brand} · </span>}
          {line.packSize} · {rupees(line.unitPricePaise)} each
        </p>

        {line.issues.map((issue) => (
          <IssueNotice key={issue.kind} issue={issue} />
        ))}
      </div>

      <div className="flex items-center gap-2">
        <ActionForm
          action={setCartQuantityAction}
          submitLabel="Update"
          className="flex items-end gap-1"
        >
          <input type="hidden" name="productId" value={line.productId} />
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Qty</span>
            <input
              name="qty"
              type="number"
              min={1}
              max={MAX_LINE_QUANTITY}
              defaultValue={line.qty}
              className="w-16 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
        </ActionForm>

        <ActionForm action={removeFromCartAction} submitLabel="Remove" className="flex items-end">
          <input type="hidden" name="productId" value={line.productId} />
        </ActionForm>

        <span className="w-20 text-right text-sm font-semibold">{rupees(line.lineTotalPaise)}</span>
      </div>
    </div>
  );
}

/**
 * A notice, not a correction.
 *
 * The quantity is never silently reduced to what is in stock: a shopper who
 * asked for 12 and can have 8 decides whether 8 is worth having.
 */
function IssueNotice({ issue }: { issue: LineIssue }): React.ReactElement {
  if (issue.kind === 'price-changed') {
    return (
      <p className="mt-1 text-xs text-amber-800">
        Price changed from {rupees(issue.oldPricePaise)} to {rupees(issue.newPricePaise)} — your
        basket uses the new price.
      </p>
    );
  }
  if (issue.kind === 'insufficient-stock') {
    return (
      <p className="mt-1 text-xs text-amber-800">
        Only {String(issue.available)} available — reduce the quantity to continue.
      </p>
    );
  }
  return <p className="mt-1 text-xs text-red-700">Out of stock at your shop right now.</p>;
}
