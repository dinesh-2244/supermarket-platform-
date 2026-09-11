import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { listCategories } from '@/modules/catalog';
import { currentStoreContext, storefrontPrincipal } from '@/storefront';
import { shopPage } from '../../catalogue';
import { pageNumber } from '../../paging';
import { Pager, ProductGrid } from '../../product-card';
import { Card, Empty, PageHeading } from '../../ui';
import { CategoryTiles } from '../../category-tiles';
import { getCartQuantities } from '../../cart-quantities';

/**
 * Category browse (D2, D3).
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
  return { title: `${category?.name ?? 'Browse'} | Munder Fresh` };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  if (context === null) redirect('/store/select');

  const { slug } = await params;
  const page = pageNumber((await searchParams).page);

  const categories = await listCategories(storefrontPrincipal(context));
  const category = categories.find((row) => row.slug === slug && row.isActive);
  if (category === undefined) notFound();

  const [shop, cartQuantities] = await Promise.all([
    shopPage(context, { categoryId: category.id, page }),
    getCartQuantities(),
  ]);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-xs text-slate-500 flex items-center gap-1.5">
        <Link href="/" className="hover:text-emerald-800">
          All products
        </Link>
        <span>›</span>
        <span className="font-semibold text-slate-800">{category.name}</span>
      </nav>

      <PageHeading
        title={category.name}
        subtitle={`${String(shop.total)} product(s) in this aisle`}
      />

      {/* Category selector row */}
      <CategoryTiles categories={categories} activeSlug={slug} />

      <Card>
        {shop.items.length === 0 ? (
          <Empty>Nothing in this aisle at your shop right now.</Empty>
        ) : (
          <>
            <ProductGrid items={shop.items} cartQuantities={cartQuantities} />
            <Pager
              page={shop.page}
              pageCount={shop.pageCount}
              hrefFor={(next) => `/c/${slug}?page=${String(next)}`}
            />
          </>
        )}
      </Card>
    </div>
  );
}
