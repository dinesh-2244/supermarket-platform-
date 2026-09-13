import type { Metadata } from 'next';
import { currentStorefrontPrincipal } from '@/storefront';
import { getStore } from '@/modules/stores';
import { STOREFRONT_COPY_MANIFEST } from '../copy-manifest';
import { ProductRequestForm } from './product-request-form';

export const metadata: Metadata = {
  title: STOREFRONT_COPY_MANIFEST.productRequest.meta.title,
  description: STOREFRONT_COPY_MANIFEST.productRequest.meta.description,
};

export default async function RequestProductPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const { context, customer, principal } = await currentStorefrontPrincipal();
  const params = await searchParams;

  const defaultName =
    typeof params.name === 'string' ? params.name : typeof params.q === 'string' ? params.q : '';

  const store =
    context?.serviceability.servable && context.serviceability.storeId
      ? await getStore(principal, context.serviceability.storeId).catch(() => null)
      : null;

  const { hero } = STOREFRONT_COPY_MANIFEST.productRequest;

  return (
    <div className="mx-auto max-w-2xl space-y-8 py-2 sm:py-6">
      {/* Header */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-800 px-6 py-10 sm:px-10 sm:py-12 text-white shadow-md">
        <div className="relative z-10">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
            {hero.badge}
          </span>
          <h1 className="mt-3 text-2xl sm:text-4xl font-black tracking-tight leading-tight">
            {hero.title}
          </h1>
          <p className="mt-2 text-xs sm:text-sm text-emerald-100 leading-relaxed max-w-lg">
            {hero.subtitle}
          </p>
          {store ? (
            <div className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-xs font-medium text-emerald-50 backdrop-blur-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              <span>
                Requesting for: <strong className="font-bold text-white">{store.name}</strong>
              </span>
            </div>
          ) : null}
        </div>
        <div className="absolute -right-6 -bottom-6 opacity-15 pointer-events-none text-8xl">
          📝
        </div>
      </section>

      {/* Form Component */}
      <ProductRequestForm
        hasStore={Boolean(context?.serviceability.servable)}
        storeName={store?.name}
        defaultProductName={defaultName}
        defaultCustomerName={customer?.name ?? ''}
        defaultCustomerPhone={customer?.phone ?? ''}
      />
    </div>
  );
}
