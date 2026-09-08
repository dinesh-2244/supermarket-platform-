import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getStore } from '@/modules/stores';
import { currentStoreContext, storefrontPrincipal } from '@/storefront';
import { rupees, Card, PageHeading } from './ui';

export const metadata: Metadata = {
  title: 'Munder Fresh',
  description: 'Groceries delivered from the shop that serves your area.',
};

/**
 * The storefront home.
 *
 * A visitor with no store context is sent to the picker rather than shown a
 * default store's catalogue: every price and every availability figure on this
 * site belongs to one specific shop, so there is nothing truthful to render
 * before we know which one (D1).
 *
 * The catalogue itself lands in P3-2; this is the shell it will hang from.
 */
export default async function StorefrontHome(): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  if (context === null) redirect('/locality');

  const { serviceability } = context;
  const store = await getStore(storefrontPrincipal(context), serviceability.storeId);

  return (
    <>
      <PageHeading
        title={`Shopping at ${store.name}`}
        subtitle="This is the shop that delivers to the area you chose."
      />

      <Card title="Delivery to your area">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Delivery fee</dt>
            <dd className="font-medium">{rupees(serviceability.deliveryFeePaise)}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Minimum order</dt>
            <dd className="font-medium">{rupees(serviceability.minOrderPaise)}</dd>
          </div>
        </dl>
      </Card>
    </>
  );
}
