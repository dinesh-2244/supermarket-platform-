import Link from 'next/link';
import type { Availability } from '@/modules/inventory';
import type { ShopItem } from './catalogue';
import { rupees } from './ui';

/**
 * The one card every listing surface uses — home, category browse and search.
 *
 * Shared deliberately: price and availability are the two things a shopper
 * compares between pages, and three near-identical cards is how one of them
 * quietly starts rounding differently or forgetting to disable "add" when a
 * shelf is empty.
 */
export function ProductCard({ item }: { item: ShopItem }): React.ReactElement {
  const { product, availability } = item;
  const discounted = item.mrpPaise > item.sellingPricePaise;

  return (
    <article className="flex h-full flex-col rounded border border-slate-200 bg-white p-3">
      <Link href={`/p/${product.slug}`} className="text-sm font-medium hover:underline">
        {product.name}
      </Link>
      <p className="mt-0.5 text-xs text-slate-500">
        {product.brand === null ? null : <span>{product.brand} · </span>}
        {product.packSize}
      </p>

      <p className="mt-2 text-sm">
        <span className="font-semibold">{rupees(item.sellingPricePaise)}</span>
        {discounted ? (
          <span className="ml-2 text-xs text-slate-500 line-through">{rupees(item.mrpPaise)}</span>
        ) : null}
      </p>

      <div className="mt-auto pt-2">
        <AvailabilityLabel
          availability={availability.availability}
          remaining={availability.remaining}
        />
      </div>
    </article>
  );
}

/**
 * Stock, as a band.
 *
 * The exact number appears only when it is low, where it is urgency the shopper
 * needs; above that they are told "in stock" and nothing more. See
 * `LOW_STOCK_DISPLAY_THRESHOLD` for why a public page does not publish counts.
 */
export function AvailabilityLabel({
  availability,
  remaining,
}: {
  availability: Availability;
  remaining: number | null;
}): React.ReactElement {
  if (availability === 'OUT_OF_STOCK') {
    return <span className="text-xs font-medium text-slate-500">Out of stock</span>;
  }
  if (availability === 'LOW') {
    return (
      <span className="text-xs font-medium text-amber-700">Only {String(remaining ?? 0)} left</span>
    );
  }
  return <span className="text-xs font-medium text-emerald-700">In stock</span>;
}

export function ProductGrid({ items }: { items: readonly ShopItem[] }): React.ReactElement {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.product.id} className="h-full">
          <ProductCard item={item} />
        </li>
      ))}
    </ul>
  );
}

/** Prev/next only — a page-number strip is noise on a phone. */
export function Pager({
  page,
  pageCount,
  hrefFor,
}: {
  page: number;
  pageCount: number;
  hrefFor: (page: number) => string;
}): React.ReactElement | null {
  if (pageCount <= 1) return null;
  return (
    <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination">
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className="text-emerald-800 underline">
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-slate-500">
        Page {String(page)} of {String(pageCount)}
      </span>
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} className="text-emerald-800 underline">
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
