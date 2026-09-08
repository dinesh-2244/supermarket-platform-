import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currentStoreContext } from '@/storefront';
import { MAX_LINE_QUANTITY } from '@/modules/cart';
import { addToCartAction } from '../../cart-actions';
import { productPage } from '../../catalogue';
import { ActionForm } from '../../form';
import { AvailabilityLabel } from '../../product-card';
import { rupees, Card, PageHeading } from '../../ui';

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
  if (context === null) redirect('/locality');

  const { slug } = await params;
  const page = await productPage(context, slug);
  if (page === null) notFound();

  const { product, availability } = page;
  const discounted = page.mrpPaise > page.sellingPricePaise;
  const outOfStock = availability.availability === 'OUT_OF_STOCK';

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-3 text-sm text-slate-600">
        <Link href="/" className="text-emerald-800 underline">
          All products
        </Link>
        {page.trail.map((category) => (
          <span key={category.id}>
            <span className="mx-1.5 text-slate-400">›</span>
            <Link href={`/c/${category.slug}`} className="text-emerald-800 underline">
              {category.name}
            </Link>
          </span>
        ))}
      </nav>

      <PageHeading
        title={product.name}
        subtitle={`${product.brand === null ? '' : `${product.brand} · `}${product.packSize}`}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          {page.images.length === 0 ? (
            <div className="flex h-48 items-center justify-center rounded bg-slate-100 text-sm text-slate-500">
              No photo yet
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {page.images.map((image) => (
                <li key={image.id}>
                  {/* Plain <img>: the URLs are operator-entered and off-domain,
                      and there is no upload pipeline in this phase. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.url}
                    alt={image.alt ?? product.name}
                    className="w-full rounded border border-slate-200"
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <p className="text-lg">
            <span className="font-semibold">{rupees(page.sellingPricePaise)}</span>
            {discounted ? (
              <span className="ml-2 text-sm text-slate-500 line-through">
                {rupees(page.mrpPaise)}
              </span>
            ) : null}
          </p>

          <p className="mt-2">
            <AvailabilityLabel
              availability={availability.availability}
              remaining={availability.remaining}
            />
          </p>

          {product.description === null ? null : (
            <p className="mt-4 whitespace-pre-line text-sm text-slate-700">{product.description}</p>
          )}

          <div className="mt-5">
            {outOfStock ? (
              // Disabled because there is nothing to add — but the *check* is
              // the server's: `addItem` re-reads listing and stock whatever the
              // page rendered, so a crafted post gets the same answer.
              <>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                >
                  Out of stock
                </button>
                <p className="mt-2 text-xs text-slate-500">
                  We will show this again as soon as it is back.
                </p>
              </>
            ) : (
              <ActionForm action={addToCartAction} submitLabel="Add to basket">
                <input type="hidden" name="productId" value={product.id} />
                <label className="text-xs text-slate-600">
                  <span className="mb-1 block">Quantity</span>
                  <input
                    name="qty"
                    type="number"
                    min={1}
                    max={MAX_LINE_QUANTITY}
                    defaultValue={1}
                    className="w-20 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </label>
              </ActionForm>
            )}
          </div>

          <dl className="mt-5 grid grid-cols-2 gap-2 text-xs text-slate-600">
            <dt>Pack size</dt>
            <dd className="text-slate-900">{product.packSize}</dd>
            {product.brand === null ? null : (
              <>
                <dt>Brand</dt>
                <dd className="text-slate-900">{product.brand}</dd>
              </>
            )}
          </dl>
        </Card>
      </div>
    </>
  );
}
