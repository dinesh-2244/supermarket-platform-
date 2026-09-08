import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MAX_SEARCH_QUERY_LENGTH } from '@/modules/catalog';
import { currentStoreContext } from '@/storefront';
import { searchShop } from '../catalogue';
import { pageNumber } from '../paging';
import { Pager, ProductGrid } from '../product-card';
import { Card, Empty, PageHeading } from '../ui';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search the shop that delivers to your area.',
};

/**
 * Search (D3).
 *
 * Scoped to the store the visitor is bound to, and ranked by the Phase 2
 * trigram service — which is what lets "basmti" find Basmati Rice. The query is
 * a parameter all the way down, never interpolated, so `%`, `_` and quotes are
 * things to search *for*.
 */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  if (context === null) redirect('/locality');

  const params = await searchParams;
  const raw = params.q;
  const query = (typeof raw === 'string' ? raw : '').slice(0, MAX_SEARCH_QUERY_LENGTH);
  const page = pageNumber(params.page);

  const trimmed = query.trim();
  const results = trimmed === '' ? null : await searchShop(context, trimmed, { page });

  return (
    <>
      <PageHeading title="Search" subtitle="Looking through the shop that delivers to you." />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="grow text-xs text-slate-600">
            <span className="mb-1 block">What are you looking for?</span>
            <input
              name="q"
              type="search"
              defaultValue={query}
              maxLength={MAX_SEARCH_QUERY_LENGTH}
              placeholder="rice, atta, coffee…"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button type="submit" className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white">
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
            <Empty>
              Nothing matched “{trimmed}” at your shop. Try a shorter word, or a brand name.
            </Empty>
          ) : (
            <>
              <ProductGrid items={results.items} />
              <Pager
                page={results.page}
                pageCount={results.pageCount}
                hrefFor={(next) => `/search?q=${encodeURIComponent(trimmed)}&page=${String(next)}`}
              />
            </>
          )}
        </Card>
      )}
    </>
  );
}
