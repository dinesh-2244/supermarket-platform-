import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { listCategories } from '@/modules/catalog';
import { currentStoreContext, storefrontPrincipal } from '@/storefront';
import { shopPage } from '../../catalogue';
import { pageNumber } from '../../paging';
import { Pager, ProductGrid } from '../../product-card';
import { Card, Empty, PageHeading } from '../../ui';

/**
 * Category browse (D2).
 *
 * A category page shows its **subtree**: browsing "Staples" must include the
 * rice filed under "Staples › Rice", or the aisle looks empty to anyone who
 * files things properly.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const context = await currentStoreContext();
  if (context === null) return { title: 'Browse' };

  const categories = await listCategories(storefrontPrincipal(context));
  const category = categories.find((row) => row.slug === slug);
  return { title: category?.name ?? 'Browse' };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  if (context === null) redirect('/locality');

  const { slug } = await params;
  const page = pageNumber((await searchParams).page);

  const categories = await listCategories(storefrontPrincipal(context));
  const category = categories.find((row) => row.slug === slug && row.isActive);
  // An unknown or retired aisle is a 404, not an empty shop.
  if (category === undefined) notFound();

  const shop = await shopPage(context, { categoryId: category.id, page });

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/" className="text-emerald-800 underline">
          All products
        </Link>
      </p>
      <PageHeading
        title={category.name}
        subtitle={`${String(shop.total)} product(s) in this aisle`}
      />

      <Card>
        {shop.items.length === 0 ? (
          <Empty>Nothing in this aisle at your shop right now.</Empty>
        ) : (
          <>
            <ProductGrid items={shop.items} />
            <Pager
              page={shop.page}
              pageCount={shop.pageCount}
              hrefFor={(next) => `/c/${slug}?page=${String(next)}`}
            />
          </>
        )}
      </Card>
    </>
  );
}
