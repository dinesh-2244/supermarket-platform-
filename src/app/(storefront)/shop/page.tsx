import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getStore, getStorefrontSettings } from '@/modules/stores';
import { currentStoreContext, storefrontPrincipal } from '@/storefront';
import { shopCategories, shopPage } from '../catalogue';
import { pageNumber } from '../paging';
import { Pager, ProductGrid } from '../product-card';
import { rupees, Card, Empty, PageHeading } from '../ui';
import { CategoryTiles } from '../category-tiles';
import { communityNameForStore } from '../communities';
import { getCartQuantities } from '../cart-quantities';

export const metadata: Metadata = {
  title: 'All Products | Munder Fresh Hyperlocal Grocery',
  description:
    'Shop fresh groceries, daily staples, fruits, vegetables, dairy, and household essentials.',
};

/**
 * Full retail storefront browse page (D3).
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  if (context === null) redirect('/store/select');

  const params = await searchParams;
  const page = pageNumber(params.page);

  const principal = storefrontPrincipal(context);
  const storeId = context.serviceability.storeId;

  const [store, settings, categories, shop, cartQuantities] = await Promise.all([
    getStore(principal, storeId),
    getStorefrontSettings(principal, storeId),
    shopCategories(context),
    shopPage(context, { page }),
    getCartQuantities(),
  ]);

  const communityName = communityNameForStore(store.id, store.name);

  return (
    <div className="space-y-6">
      <PageHeading
        title={`Shopping at ${communityName}`}
        subtitle={`Scheduled slot delivery · Delivery ${rupees(settings.deliveryFeePaise)} · Min order ${rupees(
          settings.minOrderPaise,
        )}`}
      />

      {settings.isAcceptingOrders ? null : (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-900">
          This store has temporarily paused orders. You can still browse products and plan your
          basket.
        </p>
      )}

      {/* Visual Category Tiles (D4) */}
      <CategoryTiles categories={categories} />

      {/* Product Catalog Grid */}
      <Card title={`All Products (${String(shop.total)} available)`}>
        {shop.items.length === 0 ? (
          <Empty>This store has no items listed currently.</Empty>
        ) : (
          <>
            <ProductGrid items={shop.items} cartQuantities={cartQuantities} />
            <Pager
              page={shop.page}
              pageCount={shop.pageCount}
              hrefFor={(next) => `/shop?page=${String(next)}`}
            />
          </>
        )}
      </Card>
    </div>
  );
}
