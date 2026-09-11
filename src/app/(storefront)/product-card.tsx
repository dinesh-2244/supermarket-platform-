import Link from 'next/link';
import type { Availability } from '@/modules/inventory';
import type { ShopItem } from './catalogue';
import { ProductCardActions } from './product-card-actions';
import { rupees } from './ui';

/**
 * Retail grocery quick-shopping card (D3).
 *
 * Implements Blinkit / BigBasket / JioMart style usability:
 * - Clear product image & visual container
 * - Discount badge ("XX% OFF")
 * - 2-line clamped title, brand & pack size
 * - Dual pricing (selling price + strikethrough MRP)
 * - Stock urgency / status
 * - 1-Click ADD button with inline quantity stepper (- 1 +)
 * - Minimum 44px touch targets for mobile accessibility
 */
export function ProductCard({
  item,
  qtyInCart = 0,
}: {
  item: ShopItem;
  qtyInCart?: number;
}): React.ReactElement {
  const { product, availability } = item;
  const discounted = item.mrpPaise > item.sellingPricePaise;
  const discountPct = discounted
    ? Math.round(((item.mrpPaise - item.sellingPricePaise) / item.mrpPaise) * 100)
    : 0;
  const isOutOfStock = availability.availability === 'OUT_OF_STOCK';

  return (
    <article className="group flex h-full flex-col rounded-2xl border border-slate-200/90 bg-white p-3 shadow-xs transition hover:border-slate-300 hover:shadow-md">
      {/* Image & Badges Container */}
      <div className="relative mb-2.5 flex h-36 sm:h-40 w-full items-center justify-center overflow-hidden rounded-xl bg-slate-50">
        <Link
          href={`/p/${product.slug}`}
          className="flex h-full w-full items-center justify-center p-2"
        >
          <span className="sr-only">{product.name}</span>
          {item.imageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={item.imageUrl}
              alt=""
              className="h-full w-full object-contain transition duration-200 group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-slate-300">
              <svg
                className="h-12 w-12 text-slate-300"
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
            </div>
          )}
        </Link>

        {/* Discount Badge */}
        {discountPct > 0 ? (
          <span className="absolute top-2 left-2 rounded-md bg-blue-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white shadow-xs">
            {discountPct}% OFF
          </span>
        ) : null}

        {/* Low Stock Urgency Pill */}
        {availability.availability === 'LOW' ? (
          <span className="absolute bottom-2 left-2 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-xs">
            Only {String(availability.remaining ?? 0)} left
          </span>
        ) : null}
      </div>

      {/* Product Title & Brand */}
      <div className="flex-1">
        <Link
          href={`/p/${product.slug}`}
          className="line-clamp-2 text-xs sm:text-sm font-semibold text-slate-900 group-hover:text-emerald-800 transition leading-snug min-h-[2.5rem]"
        >
          {product.name}
        </Link>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {product.brand === null ? null : <span>{product.brand} · </span>}
          <span className="font-medium text-slate-600">{product.packSize}</span>
        </p>
      </div>

      {/* Pricing & Stock Section */}
      <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-baseline justify-between gap-1">
        <div>
          <span className="text-sm sm:text-base font-extrabold text-slate-900">
            {rupees(item.sellingPricePaise)}
          </span>
          {discounted ? (
            <span className="ml-1.5 text-xs text-slate-400 line-through">
              {rupees(item.mrpPaise)}
            </span>
          ) : null}
        </div>

        <div>
          <AvailabilityLabel
            availability={availability.availability}
            remaining={availability.remaining}
          />
        </div>
      </div>

      {/* 1-Click ADD / Quantity Stepper Action (D3) */}
      <div className="mt-3">
        <ProductCardActions
          productId={product.id}
          productName={product.name}
          qtyInCart={qtyInCart}
          isOutOfStock={isOutOfStock}
        />
      </div>
    </article>
  );
}

/**
 * Stock label as a band (D3).
 */
export function AvailabilityLabel({
  availability,
  remaining,
}: {
  availability: Availability;
  remaining: number | null;
}): React.ReactElement {
  if (availability === 'OUT_OF_STOCK') {
    return <span className="text-[11px] font-medium text-slate-400">Out of stock</span>;
  }
  if (availability === 'LOW') {
    return (
      <span className="text-[11px] font-semibold text-amber-700">
        Only {String(remaining ?? 0)} left
      </span>
    );
  }
  return <span className="text-[11px] font-semibold text-emerald-700">In stock</span>;
}

export function ProductGrid({
  items,
  cartQuantities,
}: {
  items: readonly ShopItem[];
  cartQuantities?: ReadonlyMap<string, number>;
}): React.ReactElement {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <li key={item.product.id} className="h-full">
          <ProductCard item={item} qtyInCart={cartQuantities?.get(item.product.id) ?? 0} />
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
    <nav className="mt-6 flex items-center justify-between text-sm" aria-label="Pagination">
      {page > 1 ? (
        <Link
          href={hrefFor(page - 1)}
          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px]"
        >
          ← Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-slate-500 font-medium">
        Page {String(page)} of {String(pageCount)}
      </span>
      {page < pageCount ? (
        <Link
          href={hrefFor(page + 1)}
          className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 min-h-[44px]"
        >
          Next →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
