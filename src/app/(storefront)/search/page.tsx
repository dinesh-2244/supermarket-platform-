import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MAX_SEARCH_QUERY_LENGTH } from '@/modules/catalog';
import { currentStoreContext } from '@/storefront';
import { searchShop } from '../catalogue';
import { STOREFRONT_COPY_MANIFEST } from '../copy-manifest';
import { pageNumber } from '../paging';
import { Pager, ProductGrid } from '../product-card';
import { Card, Empty, PageHeading } from '../ui';
import { getCartQuantities } from '../cart-quantities';

export const metadata: Metadata = {
  title: 'Search Groceries | Munder Fresh',
  description:
    'Search fresh groceries, daily staples, dairy, and household essentials in your community.',
};

/**
 * Search (D3, D5).
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  if (context === null) redirect('/store/select');

  const params = await searchParams;
  const raw = params.q;
  const query = (typeof raw === 'string' ? raw : '').slice(0, MAX_SEARCH_QUERY_LENGTH);
  const page = pageNumber(params.page);

  const trimmed = query.trim();
  const [results, cartQuantities] = await Promise.all([
    trimmed === '' ? null : searchShop(context, trimmed, { page }),
    getCartQuantities(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Search Catalogue"
        subtitle="Searching products available for delivery to your community."
      />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="grow text-xs text-slate-600">
            <span className="mb-1 block font-medium">What are you looking for?</span>
            <input
              name="q"
              type="search"
              defaultValue={query}
              maxLength={MAX_SEARCH_QUERY_LENGTH}
              placeholder="e.g. Atta, Sona Masoori, Milk, Tomato, Oil..."
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-emerald-600 focus:outline-none min-h-[44px]"
              autoFocus
            />
          </label>
          <button
            type="submit"
            className="rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-800 transition min-h-[44px]"
          >
            Search
          </button>
        </form>
      </Card>

      {results === null ? (
        <Card>
          <Empty>Type something above to search this shop.</Empty>
        </Card>
      ) : (
        <Card title={`${String(results.total)} result(s) for “${trimmed}”`}>
          {results.items.length === 0 ? (
            <div className="space-y-4 text-center py-2">
              <Empty>
                Nothing matched “{trimmed}” at your shop. Try a shorter word, or check our category
                aisles.
              </Empty>
              <div className="pt-2">
                <Link
                  href={`/request-product?q=${encodeURIComponent(trimmed)}`}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition"
                >
                  {STOREFRONT_COPY_MANIFEST.productRequest.searchPrompt.text}{' '}
                  {STOREFRONT_COPY_MANIFEST.productRequest.searchPrompt.linkText}
                </Link>
              </div>
            </div>
          ) : (
            <>
              <ProductGrid items={results.items} cartQuantities={cartQuantities} />
              <Pager
                page={results.page}
                pageCount={results.pageCount}
                hrefFor={(next) => `/search?q=${encodeURIComponent(trimmed)}&page=${String(next)}`}
              />
              <div className="mt-6 border-t border-slate-100 pt-4 text-center">
                <p className="text-xs text-slate-500">
                  {STOREFRONT_COPY_MANIFEST.productRequest.searchPrompt.text}{' '}
                  <Link
                    href={`/request-product?q=${encodeURIComponent(trimmed)}`}
                    className="font-bold text-emerald-700 hover:underline"
                  >
                    {STOREFRONT_COPY_MANIFEST.productRequest.searchPrompt.linkText}
                  </Link>
                </p>
              </div>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
