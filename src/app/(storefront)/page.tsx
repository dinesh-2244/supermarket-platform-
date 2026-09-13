import type { Metadata } from 'next';
import Link from 'next/link';
import { getStore, getStorefrontSettings } from '@/modules/stores';
import { currentStoreContext, storefrontPrincipal } from '@/storefront';
import { shopCategories, shopPage } from './catalogue';
import { pageNumber } from './paging';
import { ProductGrid } from './product-card';
import { rupees, Card, Empty } from './ui';
import { CommunitySelector } from './community-selector';
import { CategoryTiles } from './category-tiles';
import { communityNameForStore } from './communities';
import { getCartQuantities } from './cart-quantities';
import {
  STOREFRONT_COPY_MANIFEST,
  formatActiveWelcomeTitle,
  formatActiveWelcomeTerms,
  formatDeliveryFee,
} from './copy-manifest';
import { WaveHorizonGraphic, PromoBannerCard, PromoBannerGrid } from './promo-banner';

export const metadata: Metadata = {
  title: STOREFRONT_COPY_MANIFEST.home.meta.title,
  description: STOREFRONT_COPY_MANIFEST.home.meta.description,
};

/**
 * The redesigned Munder Fresh storefront homepage (D1).
 *
 * For first-time visitors (context === null):
 * - Displays an engaging, branded experience with prominent 2-card community selection
 * - Highlights service guarantees, category previews, and delivery policies
 * - Customers are NOT dropped into a raw, confusing locality table
 *
 * For returning visitors (context !== null):
 * - Greets with active community context, delivery promises, and category visual tiles
 * - Renders quick-shopping retail shelves with 1-click ADD and quantity steppers
 */
export default async function StorefrontHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const context = await currentStoreContext();

  // -------------------------------------------------------------------------
  // 1. First-Time Shopper Experience (context === null)
  // -------------------------------------------------------------------------
  if (context === null) {
    return (
      <div className="space-y-12 py-4 sm:py-8">
        {/* Hero Section */}
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-6 py-12 sm:px-12 sm:py-16 text-white shadow-lg border border-slate-800">
          <WaveHorizonGraphic className="text-sky-400/10" />
          <div className="relative z-10 max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur text-sky-200 border border-sky-400/20">
              {STOREFRONT_COPY_MANIFEST.home.hero.badge}
            </span>
            <h1 className="mt-4 text-3xl sm:text-5xl font-black tracking-tight leading-tight">
              {STOREFRONT_COPY_MANIFEST.home.hero.titlePrefix}
              <span className="text-sky-200 underline decoration-amber-400">
                {STOREFRONT_COPY_MANIFEST.home.hero.titleHighlight}
              </span>
            </h1>
            <p className="mt-3 text-sm sm:text-base text-slate-300 max-w-lg leading-relaxed">
              {STOREFRONT_COPY_MANIFEST.home.hero.subtitle}
            </p>
          </div>
        </section>

        {/* Community Selector (D2) */}
        <CommunitySelector
          title={STOREFRONT_COPY_MANIFEST.home.communitySelector.title}
          subtitle={STOREFRONT_COPY_MANIFEST.home.communitySelector.subtitle}
          showAreaSublist={false}
        />

        {/* Quality & Trust Highlights */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-2xl">⚡</span>
            <h3 className="mt-2 text-xs sm:text-sm font-bold text-slate-900">
              {STOREFRONT_COPY_MANIFEST.home.highlights.slotsTitle}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {STOREFRONT_COPY_MANIFEST.home.highlights.slotsDescription}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-2xl">🥦</span>
            <h3 className="mt-2 text-xs sm:text-sm font-bold text-slate-900">
              {STOREFRONT_COPY_MANIFEST.home.highlights.produceTitle}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {STOREFRONT_COPY_MANIFEST.home.highlights.produceDescription}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-2xl">🛡️</span>
            <h3 className="mt-2 text-xs sm:text-sm font-bold text-slate-900">
              {STOREFRONT_COPY_MANIFEST.home.highlights.paymentTitle}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {STOREFRONT_COPY_MANIFEST.home.highlights.paymentDescription}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-2xl">🏠</span>
            <h3 className="mt-2 text-xs sm:text-sm font-bold text-slate-900">
              {STOREFRONT_COPY_MANIFEST.home.highlights.doorstepTitle}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {STOREFRONT_COPY_MANIFEST.home.highlights.doorstepDescription}
            </p>
          </div>
        </section>

        {/* About Munder Fresh Preview (Requirement 3b) */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-6">
          <div className="max-w-xl">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
              {STOREFRONT_COPY_MANIFEST.home.aboutPreview.badge}
            </span>
            <h2 className="mt-1 text-xl sm:text-2xl font-black text-slate-900">
              {STOREFRONT_COPY_MANIFEST.home.aboutPreview.title}
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              {STOREFRONT_COPY_MANIFEST.home.aboutPreview.description}
            </p>
            <p className="mt-3 text-xs font-semibold italic text-slate-700 border-l-2 border-slate-300 pl-3">
              &ldquo;{STOREFRONT_COPY_MANIFEST.home.aboutPreview.closingLine}&rdquo;
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <Link
              href="/about"
              className="inline-flex items-center rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition min-h-[44px]"
            >
              Learn More About Us →
            </Link>
            <Link
              href="/store/select"
              className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition min-h-[44px]"
            >
              Select Community →
            </Link>
          </div>
        </section>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // 2. Active Shopper Experience (context !== null)
  // -------------------------------------------------------------------------
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

  const communityName = communityNameForStore(store);

  return (
    <div className="space-y-8">
      {/* Active Community Welcome Bar */}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-slate-900 text-white border border-slate-800 px-4 py-3.5 sm:px-6 shadow-sm">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-sky-300">
            {STOREFRONT_COPY_MANIFEST.home.activeWelcome.badge}
          </span>
          <h1 className="text-lg sm:text-xl font-black text-white">
            {formatActiveWelcomeTitle(communityName)}
          </h1>
          <p className="text-xs text-slate-300 mt-0.5">
            {formatActiveWelcomeTerms(
              formatDeliveryFee(settings.deliveryFeePaise),
              rupees(settings.minOrderPaise),
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/shop"
            className="inline-flex items-center rounded-xl bg-white px-3.5 py-2 text-xs font-bold text-slate-900 shadow-xs hover:bg-sky-50 transition min-h-[44px]"
          >
            {STOREFRONT_COPY_MANIFEST.home.activeWelcome.browseShopButton}
          </Link>
          <Link
            href="/store/select"
            className="inline-flex items-center rounded-xl border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-xs hover:bg-slate-700 min-h-[44px]"
          >
            {STOREFRONT_COPY_MANIFEST.home.activeWelcome.changeCommunityButton}
          </Link>
        </div>
      </section>

      {settings.isAcceptingOrders ? null : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900">
          {STOREFRONT_COPY_MANIFEST.home.activeWelcome.pausedNotice}
        </div>
      )}

      {/* Promotional Banners Carousel/Grid */}
      <PromoBannerGrid>
        <PromoBannerCard
          badge={STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.badge}
          title={STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.title}
          description={STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.description}
          buttonText={STOREFRONT_COPY_MANIFEST.home.promoBanners.dailyEssentials.buttonText}
          href="/c/fruits-vegetables"
          variant="navy"
        />
        <PromoBannerCard
          badge={STOREFRONT_COPY_MANIFEST.home.promoBanners.superSaver.badge}
          title={STOREFRONT_COPY_MANIFEST.home.promoBanners.superSaver.title}
          description={STOREFRONT_COPY_MANIFEST.home.promoBanners.superSaver.description}
          buttonText={STOREFRONT_COPY_MANIFEST.home.promoBanners.superSaver.buttonText}
          href="/c/staples"
          variant="ocean"
        />
      </PromoBannerGrid>

      {/* Category Visual Tiles (D4) */}
      <CategoryTiles categories={categories} />

      {/* Curated Retail Highlights Shelf (Requirement 3b) */}
      <Card title={`Featured Products (${String(shop.total)} product(s))`}>
        {shop.items.length === 0 ? (
          <Empty>This shop has nothing listed yet.</Empty>
        ) : (
          <>
            <ProductGrid items={shop.items.slice(0, 8)} cartQuantities={cartQuantities} />
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl bg-slate-50 border border-slate-200/80 p-5">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Explore the Full Catalogue</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Browse all {String(shop.total)} products across categories with search, filters,
                  and complete listings in our Shop.
                </p>
              </div>
              <Link
                href="/shop"
                className="inline-flex items-center justify-center rounded-xl bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 transition min-h-[44px] shrink-0"
              >
                Open Full Shop Catalogue →
              </Link>
            </div>
          </>
        )}
      </Card>

      {/* Hyperlocal Operations & About Callout (Requirement 3b) */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="max-w-xl">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              {STOREFRONT_COPY_MANIFEST.home.promise.badge}
            </span>
            <h2 className="mt-1 text-xl sm:text-2xl font-black text-slate-900">
              {STOREFRONT_COPY_MANIFEST.home.promise.title}
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              {STOREFRONT_COPY_MANIFEST.home.promise.description}
            </p>
          </div>
          <Link
            href="/about"
            className="inline-flex items-center rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition min-h-[44px] shrink-0"
          >
            Learn More About Us →
          </Link>
        </div>
      </section>
    </div>
  );
}
