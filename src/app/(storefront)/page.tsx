import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getStore, getStorefrontSettings } from '@/modules/stores';
import { currentStoreContext, storefrontPrincipal } from '@/storefront';
import { shopCategories, shopPage } from './catalogue';
import { pageNumber } from './paging';
import { Pager, ProductGrid } from './product-card';
import { rupees, Card, Empty, PageHeading } from './ui';

export const metadata: Metadata = {
  title: 'Munder Fresh',
  description: 'Groceries delivered from the shop that serves your area.',
};

/**
 * The storefront home (D2).
 *
 * A visitor with no store context is sent to the picker rather than shown a
 * default store's catalogue: every price and every availability figure here
 * belongs to one specific shop, so there is nothing truthful to render before
 * we know which one.
 */
export default async function StorefrontHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  if (context === null) redirect('/locality');

  const params = await searchParams;
  const page = pageNumber(params.page);

  const principal = storefrontPrincipal(context);
  const storeId = context.serviceability.storeId;
  const [store, settings, categories, shop] = await Promise.all([
    getStore(principal, storeId),
    getStorefrontSettings(principal, storeId),
    shopCategories(context),
    shopPage(context, { page }),
  ]);

  return (
    <>
      <PageHeading
        title={`Shopping at ${store.name}`}
        subtitle={`Delivery ${rupees(settings.deliveryFeePaise)} · minimum order ${rupees(
          settings.minOrderPaise,
        )}`}
      />

      {settings.isAcceptingOrders ? null : (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This shop has paused orders for now. You can still look around.
        </p>
      )}

      {categories.length === 0 ? null : (
        <Card title="Shop by aisle">
          <ul className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/c/${category.slug}`}
                  className="inline-block rounded-full border border-slate-300 px-3 py-1 text-sm hover:border-emerald-700"
                >
                  {category.name}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`${String(shop.total)} product(s)`}>
        {shop.items.length === 0 ? (
          <Empty>This shop has nothing listed yet.</Empty>
        ) : (
          <>
            <ProductGrid items={shop.items} />
            <Pager
              page={shop.page}
              pageCount={shop.pageCount}
              hrefFor={(next) => `/?page=${String(next)}`}
            />
          </>
        )}
      </Card>
    </>
  );
}
