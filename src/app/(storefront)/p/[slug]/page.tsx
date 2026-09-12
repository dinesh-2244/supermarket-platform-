import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentStoreContext } from '@/storefront';
import { MAX_LINE_QUANTITY } from '@/modules/cart';
import { addToCartAction } from '../../cart-actions';
import { productPage } from '../../catalogue';
import { ActionForm } from '../../form';
import { AvailabilityLabel } from '../../product-card';
import { rupees } from '../../ui';

/**
 * Product detail (D2).
 *
 * The slug is global; this store's context decides whether the product is sold
 * here, what it costs and whether it is in stock. A product this shop does not
 * list is a **404** — the same answer as a slug that does not exist, because
 * telling a shopper "the other store sells this" is not ours to tell.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const context = await currentStoreContext();
  if (context === null) return { title: 'Product' };

  const page = await productPage(context, slug);
  if (page === null) return { title: 'Product not found' };

  return {
    title: page.product.name,
    description:
      page.product.description ??
      `${page.product.name}${page.product.brand === null ? '' : ` by ${page.product.brand}`} — ${page.product.packSize}`,
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  if (context === null) redirect('/store/select');

  const { slug } = await params;
  const page = await productPage(context, slug);
  if (page === null) notFound();

  const { product, availability } = page;
  const discounted = page.mrpPaise > page.sellingPricePaise;
  const discountPct = discounted
    ? Math.round(((page.mrpPaise - page.sellingPricePaise) / page.mrpPaise) * 100)
    : 0;
  const outOfStock = availability.availability === 'OUT_OF_STOCK';

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      {/* Breadcrumb Navigation */}
      <nav
        aria-label="Breadcrumb"
        className="mb-6 flex flex-wrap items-center gap-1.5 text-xs sm:text-sm text-slate-500"
      >
        <Link
          href="/"
          className="inline-flex min-h-[44px] items-center font-medium text-emerald-800 underline hover:text-emerald-900 transition"
        >
          All products
        </Link>
        {page.trail.map((category) => (
          <span key={category.id} className="inline-flex items-center">
            <span className="mx-1 text-slate-300">/</span>
            <Link
              href={`/c/${category.slug}`}
              className="inline-flex min-h-[44px] items-center font-medium text-emerald-800 underline hover:text-emerald-900 transition"
            >
              {category.name}
            </Link>
          </span>
        ))}
      </nav>

      {/* Main Product Showcase Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 items-start">
        {/* Left Column: Image Showcase / Gallery */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-4 sm:p-6 shadow-xs">
          {page.images.length === 0 ? (
            <div className="flex min-h-[280px] sm:min-h-[380px] flex-col items-center justify-center rounded-2xl bg-slate-50 p-8 text-center text-slate-400">
              <svg
                className="h-16 w-16 text-slate-300 mb-2"
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
              <p className="text-sm font-semibold text-slate-500">No photo yet</p>
              <p className="text-xs text-slate-400 mt-1">Product image will appear once added</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {/* Primary Hero Image */}
              <div className="relative flex min-h-[280px] sm:min-h-[380px] w-full items-center justify-center overflow-hidden rounded-2xl bg-slate-50 p-6 sm:p-8">
                {/* Plain <img>: operator-entered off-domain asset URLs */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={page.images[0]?.url}
                  alt={page.images[0]?.alt ?? product.name}
                  className="max-h-80 w-full object-contain transition duration-200 hover:scale-105"
                />
                {discountPct > 0 ? (
                  <span className="absolute top-3 left-3 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-black text-white shadow-xs">
                    {discountPct}% OFF
                  </span>
                ) : null}
                {availability.availability === 'LOW' ? (
                  <span className="absolute bottom-3 left-3 rounded-md bg-amber-500/90 px-2 py-0.5 text-xs font-bold text-white shadow-xs">
                    Only {String(availability.remaining ?? 0)} left
                  </span>
                ) : null}
              </div>

              {/* Additional Image Thumbnails if multiple exist */}
              {page.images.length > 1 ? (
                <ul className="flex flex-wrap gap-2 pt-2">
                  {page.images.map((image) => (
                    <li
                      key={image.id}
                      className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-1.5 shadow-2xs"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.url}
                        alt={image.alt ?? product.name}
                        className="h-full w-full object-contain"
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>

        {/* Right Column: Details, Price, Stock & Add to Basket */}
        <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs flex flex-col justify-between">
          <div>
            {/* Brand & Pack Badges */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {product.brand ? (
                <span className="rounded-md bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-700">
                  {product.brand}
                </span>
              ) : null}
              <span className="rounded-md bg-emerald-50 border border-emerald-200/80 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                {product.packSize}
              </span>
            </div>

            {/* Product Title */}
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
              {product.name}
            </h1>

            {/* Price & Savings */}
            <div className="mt-4 flex flex-wrap items-baseline gap-2.5">
              <span className="text-2xl sm:text-3xl font-black text-slate-900">
                {rupees(page.sellingPricePaise)}
              </span>
              {discounted ? (
                <>
                  <span className="text-base text-slate-400 line-through font-medium">
                    MRP {rupees(page.mrpPaise)}
                  </span>
                  <span className="rounded-lg bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-bold text-emerald-800">
                    Save {rupees(page.mrpPaise - page.sellingPricePaise)}
                  </span>
                </>
              ) : null}
            </div>

            {/* Stock Availability */}
            <div className="mt-4">
              <AvailabilityLabel
                availability={availability.availability}
                remaining={availability.remaining}
              />
            </div>

            {/* Add to Basket Action Form */}
            <div className="mt-6 rounded-2xl border border-slate-200/90 bg-slate-50/70 p-5 shadow-xs">
              {outOfStock ? (
                <div>
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-200 px-6 py-2.5 text-sm font-bold text-slate-500 cursor-not-allowed opacity-80"
                  >
                    Out of stock
                  </button>
                  <p className="mt-2 text-xs text-slate-500">
                    We will show this again as soon as it is back.
                  </p>
                </div>
              ) : (
                <ActionForm
                  action={addToCartAction}
                  submitLabel="Add to basket"
                  className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
                  submitButtonClassName="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition disabled:opacity-50"
                >
                  <input type="hidden" name="productId" value={product.id} />
                  <label className="text-xs font-bold text-slate-700">
                    <span className="mb-1.5 block">Quantity</span>
                    <input
                      name="qty"
                      type="number"
                      min={1}
                      max={MAX_LINE_QUANTITY}
                      defaultValue={1}
                      className="w-full sm:w-24 min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 shadow-xs focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                    />
                  </label>
                </ActionForm>
              )}
            </div>

            {/* Product Specifications & Description */}
            <div className="mt-6 space-y-4 border-t border-slate-200/80 pt-6">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-900">
                Product Details
              </h2>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                  <dt className="text-slate-500">Pack size</dt>
                  <dd className="mt-0.5 font-bold text-slate-900">{product.packSize}</dd>
                </div>
                {product.brand ? (
                  <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-3">
                    <dt className="text-slate-500">Brand</dt>
                    <dd className="mt-0.5 font-bold text-slate-900">{product.brand}</dd>
                  </div>
                ) : null}
              </dl>

              {product.description ? (
                <div className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4">
                  <h3 className="text-xs font-bold text-slate-700 mb-1">Description</h3>
                  <p className="whitespace-pre-line text-xs sm:text-sm text-slate-600 leading-relaxed">
                    {product.description}
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {/* Service Trust Banner */}
          <div className="mt-6 rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 text-xs text-slate-700 font-medium">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                  ✓
                </span>
                <span>Scheduled slot fresh delivery</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                  ✓
                </span>
                <span>Live store pricing & availability</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
