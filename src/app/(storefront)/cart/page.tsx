import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  MAX_LINE_QUANTITY,
  viewCart,
  type CartLine,
  type CartNotice,
  type LineIssue,
  type RemovedLine,
} from '@/modules/cart';
import { listProductImages } from '@/modules/catalog';
import { getStore } from '@/modules/stores';
import {
  currentCartToken,
  currentStoreContext,
  storefrontPrincipal,
  readCartMoveNotice,
} from '@/storefront';
import type { ReadCartMoveNotice } from '@/storefront';
import { getCommunityConfigForStore } from '../communities';
import { removeFromCartAction, setCartQuantityAction } from '../cart-actions';
import { noticeSentences } from '../cart-notices';
import { ActionForm } from '../form';
import { rupees, Card, PageHeading } from '../ui';

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
  if (context === null) redirect('/store/select');

  const principal = storefrontPrincipal(context);
  const cartToken = await currentCartToken();
  const [cart, moved, store] = await Promise.all([
    cartToken === null ? null : viewCart(principal, cartToken),
    readCartMoveNotice(),
    getStore(principal, context.serviceability.storeId).catch(() => null),
  ]);

  const community = getCommunityConfigForStore(store);

  if (cart === null || cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <PageHeading title="Your basket" />
        {moved === null ? null : <MoveNotice notice={moved} />}
        {cart?.notice == null ? null : <ChangeNotice notice={cart.notice} />}
        {cart === null || cart.removed.length === 0 ? null : (
          <RemovedNotice removed={cart.removed} />
        )}
        <Card className="rounded-3xl border border-slate-200/90 bg-white p-8 sm:p-12 text-center shadow-xs">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <svg
              className="h-10 w-10 text-emerald-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.75}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
          </div>
          <p className="text-lg font-bold text-slate-900">Your basket is empty.</p>
          <p className="mt-1 text-sm text-slate-500 max-w-sm mx-auto">
            Explore fresh fruits, vegetables, dairy & daily staples from your community store.
          </p>
          <div className="mt-6">
            <Link
              href="/"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition"
            >
              Start shopping
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // Fetch product images for all active lines in parallel
  const imageMap = new Map<string, string>();
  await Promise.all(
    cart.lines.map(async (line) => {
      try {
        const images = await listProductImages(principal, line.productId);
        if (images[0]?.url) {
          imageMap.set(line.productId, images[0].url);
        }
      } catch {
        // Fallback gracefully
      }
    }),
  );

  const { totals } = cart;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/shop"
            className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 hover:text-emerald-900 transition mb-2"
          >
            ← Continue shopping
          </Link>
          <PageHeading
            title="Your basket"
            subtitle="Prices and availability are checked against the shop every time you look."
          />
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-600/20 bg-emerald-50/80 px-3.5 py-1.5 text-xs font-medium text-emerald-900">
          <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" />
          <span>{community.name}</span>
        </div>
      </div>

      {moved === null ? null : <MoveNotice notice={moved} />}
      {cart.notice === null ? null : <ChangeNotice notice={cart.notice} />}
      {cart.removed.length === 0 ? null : <RemovedNotice removed={cart.removed} />}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Cart items list */}
        <div className="lg:col-span-7">
          <Card className="rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs">
            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">
                Items in Basket
              </h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                {String(totals.itemCount)} {totals.itemCount === 1 ? 'item' : 'items'}
              </span>
            </div>

            <ul className="flex flex-col divide-y divide-slate-100">
              {cart.lines.map((line) => (
                <li key={line.productId} className="py-4 first:pt-1 last:pb-1">
                  <CartRow line={line} imageUrl={imageMap.get(line.productId)} />
                </li>
              ))}
            </ul>
          </Card>
        </div>

        {/* Bill Summary / Checkout CTA */}
        <div className="lg:col-span-5">
          <Card
            title="Total"
            className="sticky top-20 rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-xs"
          >
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex justify-between text-slate-600">
                <dt>Subtotal ({String(totals.itemCount)} item(s))</dt>
                <dd className="font-semibold text-slate-900">{rupees(totals.subtotalPaise)}</dd>
              </div>
              <div className="flex justify-between text-slate-600">
                <dt>Delivery</dt>
                <dd className="font-medium text-slate-900">{rupees(totals.deliveryFeePaise)}</dd>
              </div>
              <div className="flex justify-between text-slate-600">
                <dt>Minimum order</dt>
                <dd className="font-medium text-slate-900">{rupees(totals.minOrderPaise)}</dd>
              </div>
              <div className="flex justify-between text-base font-bold text-slate-900 pt-3 border-t border-slate-100">
                <dt>Estimated total</dt>
                <dd className="text-emerald-700">
                  {rupees(totals.subtotalPaise + totals.deliveryFeePaise)}
                </dd>
              </div>
            </dl>

            {totals.meetsMinimum ? null : (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="font-medium">
                  Add {rupees(totals.minOrderPaise - totals.subtotalPaise)} more to reach the
                  minimum order for your area.
                </p>
              </div>
            )}

            <div className="mt-5">
              <Link
                href="/checkout"
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-3.5 text-center text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition"
              >
                Proceed to checkout
              </Link>
              <p className="mt-2.5 text-center text-xs text-slate-500">
                No account needed. You pay when your order is delivered.
              </p>
            </div>

            <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500 space-y-2">
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 text-emerald-600 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>Scheduled slot delivery</span>
              </div>
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 text-emerald-600 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>Fresh daily quality guaranteed</span>
              </div>
              <div className="flex items-center gap-2">
                <svg
                  className="h-4 w-4 text-emerald-600 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span>Pay with Cash or UPI on delivery</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * What the last basket action found when it revalidated.
 */
function ChangeNotice({ notice }: { notice: CartNotice }): React.ReactElement {
  const sentences = noticeSentences(notice);
  return (
    <div
      role="status"
      className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <svg
          className="h-5 w-5 text-amber-600 shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <ul className="flex flex-col gap-1.5 min-w-0">
          {sentences.map((sentence) => (
            <li key={sentence} className="leading-relaxed">
              {sentence}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * Lines this revalidation took out, and why.
 */
function RemovedNotice({ removed }: { removed: readonly RemovedLine[] }): React.ReactElement {
  return (
    <div
      role="status"
      className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <svg
          className="h-5 w-5 text-amber-600 shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <p className="leading-relaxed">
          We had to take {removed.length === 1 ? 'an item' : 'some items'} out:{' '}
          <span className="font-medium">
            {removed
              .map(
                (row) =>
                  `${row.name} (${row.reason === 'unlisted' ? 'no longer sold here' : 'discontinued'})`,
              )
              .join(', ')}
          </span>
          .
        </p>
      </div>
    </div>
  );
}

/**
 * What happened when the basket followed the shopper to another shop.
 */
function MoveNotice({ notice }: { notice: ReadCartMoveNotice }): React.ReactElement {
  return (
    <div
      role="status"
      className="mb-6 rounded-2xl border border-blue-200 bg-blue-50/90 p-4 text-sm text-blue-950 shadow-xs"
    >
      <div className="flex items-start gap-3">
        <svg
          className="h-5 w-5 text-blue-600 shrink-0 mt-0.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <p className="leading-relaxed">
          Your basket moved to <span className="font-semibold">{notice.storeName}</span>, and is now
          priced there.
          {notice.carriedTotal === 0 ? null : (
            <>
              {' '}
              Came with you: {notice.carried.join(', ')}
              {notice.carriedTotal > notice.carried.length
                ? ` and ${String(notice.carriedTotal - notice.carried.length)} more`
                : ''}
              .
            </>
          )}
          {notice.droppedTotal === 0 ? null : (
            <>
              {' '}
              Not sold or not in stock there, so removed: {notice.dropped.join(', ')}
              {notice.droppedTotal > notice.dropped.length
                ? ` and ${String(notice.droppedTotal - notice.dropped.length)} more`
                : ''}
              .
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function CartRow({
  line,
  imageUrl,
}: {
  line: CartLine;
  imageUrl?: string | null | undefined;
}): React.ReactElement {
  return (
    <div className="flex items-start gap-3 sm:gap-4">
      {/* Product Image Container */}
      <div className="relative flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50">
        <Link
          href={`/p/${line.slug}`}
          className="flex h-full w-full items-center justify-center p-1.5"
        >
          <span className="sr-only">{line.name}</span>
          {imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={imageUrl} alt="" className="h-full w-full object-contain" loading="lazy" />
          ) : (
            <svg
              className="h-8 w-8 text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
          )}
        </Link>
      </div>

      {/* Info & Actions */}
      <div className="flex min-w-0 grow flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/p/${line.slug}`}
              className="line-clamp-2 text-sm font-semibold text-slate-900 hover:text-emerald-700 transition"
            >
              {line.name}
            </Link>
            <p className="mt-0.5 text-xs text-slate-500">
              {line.brand === null ? null : <span>{line.brand} · </span>}
              {line.packSize} · {rupees(line.unitPricePaise)} each
            </p>
          </div>

          <span className="shrink-0 text-base font-bold text-slate-900">
            {rupees(line.lineTotalPaise)}
          </span>
        </div>

        {line.issues.map((issue) => (
          <IssueNotice key={issue.kind} issue={issue} />
        ))}

        {/* Mobile-accessible interactive actions (>=44px touch targets) */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ActionForm
            action={setCartQuantityAction}
            submitLabel="Update"
            className="flex items-center gap-1.5"
            submitButtonClassName="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-100 hover:border-slate-300 active:scale-95 transition disabled:opacity-50"
          >
            <input type="hidden" name="productId" value={line.productId} />
            <label className="text-xs text-slate-600 flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-500">Qty</span>
              <input
                name="qty"
                type="number"
                min={1}
                max={MAX_LINE_QUANTITY}
                defaultValue={line.qty}
                className="h-11 w-16 rounded-xl border border-slate-300 bg-white px-2.5 text-center text-sm font-bold text-slate-900 shadow-xs focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
              />
            </label>
          </ActionForm>

          <ActionForm
            action={removeFromCartAction}
            submitLabel="Remove"
            className="flex items-center"
            submitButtonClassName="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-rose-200/70 bg-rose-50/60 px-3.5 py-2 text-xs font-semibold text-rose-700 shadow-xs hover:bg-rose-100 active:scale-95 transition disabled:opacity-50"
          >
            <input type="hidden" name="productId" value={line.productId} />
          </ActionForm>
        </div>
      </div>
    </div>
  );
}

/**
 * A notice, not a correction.
 */
function IssueNotice({ issue }: { issue: LineIssue }): React.ReactElement {
  if (issue.kind === 'price-changed') {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 border border-amber-200/80">
        Price changed from {rupees(issue.oldPricePaise)} to {rupees(issue.newPricePaise)} — your
        basket uses the new price.
      </p>
    );
  }
  if (issue.kind === 'insufficient-stock') {
    return (
      <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 border border-amber-200/80">
        Only {String(issue.available)} available — reduce the quantity to continue.
      </p>
    );
  }
  return (
    <p className="mt-1.5 inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 border border-rose-200/80">
      Out of stock at your shop right now.
    </p>
  );
}
