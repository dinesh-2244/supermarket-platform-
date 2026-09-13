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

export const metadata: Metadata = {
  title: 'Munder Fresh | Hyperlocal Grocery Platform',
  description:
    'Farm-fresh groceries, daily essentials, dairy, staples, and fruits delivered to your community in scheduled slots.',
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
        <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-800 px-6 py-12 sm:px-12 sm:py-16 text-white shadow-md">
          <div className="relative z-10 max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
              Hyperlocal Residential Delivery
            </span>
            <h1 className="mt-4 text-3xl sm:text-5xl font-black tracking-tight leading-tight">
              Fresh Groceries Delivered in{' '}
              <span className="text-emerald-200 underline decoration-amber-400">
                Scheduled Slots
              </span>
            </h1>
            <p className="mt-3 text-sm sm:text-base text-emerald-100 max-w-lg leading-relaxed">
              Doorstep delivery of farm-fresh fruits &amp; vegetables, dairy, pulses, staples, and
              daily home essentials. Picked fresh and delivered by your dedicated community store
              hub.
            </p>
          </div>
          <div className="absolute -right-12 -bottom-12 opacity-15 pointer-events-none text-9xl">
            🥦
          </div>
        </section>

        {/* Community Selector (D2) */}
        <CommunitySelector
          title="Select Your Community to Start Shopping"
          subtitle="Choose your residential community to see accurate local stock, today's fresh pricing, and booking slots."
          showAreaSublist={false}
        />

        {/* Quality & Trust Highlights */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-2xl">⚡</span>
            <h3 className="mt-2 text-xs sm:text-sm font-bold text-slate-900">Scheduled Slots</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Pick your preferred delivery window</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-2xl">🥦</span>
            <h3 className="mt-2 text-xs sm:text-sm font-bold text-slate-900">Farm Fresh Daily</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Vegetables & fruits sourced every morning
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-2xl">🛡️</span>
            <h3 className="mt-2 text-xs sm:text-sm font-bold text-slate-900">Pay on Delivery</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">Cash or UPI accepted at doorstep</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
            <span className="text-2xl">🏠</span>
            <h3 className="mt-2 text-xs sm:text-sm font-bold text-slate-900">Direct to Door</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Delivery straight to your flat or home
            </p>
          </div>
        </section>

        {/* About Munder Fresh Preview (Requirement 3b) */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="max-w-xl">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
              About Our Model
            </span>
            <h2 className="mt-1 text-xl sm:text-2xl font-black text-slate-900">
              Hyperlocal Grocery Built for Residential Communities
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              We operate dedicated mini-hubs for partner residential societies. Learn how our
              two-community model delivers scheduled morning and evening slots with zero surprise
              markups.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/about"
              className="inline-flex items-center rounded-xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 transition min-h-[44px]"
            >
              Learn More About Us →
            </Link>
            <Link
              href="/store/select"
              className="inline-flex items-center rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 transition min-h-[44px]"
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
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50/90 border border-emerald-200/80 px-4 py-3.5 sm:px-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
            Delivering from your local hub
          </span>
          <h1 className="text-lg sm:text-xl font-black text-slate-900">
            Shopping at {communityName}
          </h1>
          <p className="text-xs text-slate-600 mt-0.5">
            Delivery {rupees(settings.deliveryFeePaise)} · Minimum order{' '}
            {rupees(settings.minOrderPaise)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/shop"
            className="inline-flex items-center rounded-xl bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 transition min-h-[44px]"
          >
            Browse Full Shop →
          </Link>
          <Link
            href="/store/select"
            className="inline-flex items-center rounded-xl border border-emerald-600 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-xs hover:bg-emerald-50 min-h-[44px]"
          >
            Change Community
          </Link>
        </div>
      </section>

      {settings.isAcceptingOrders ? null : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-900">
          This community hub has paused order taking for now. You can still browse and add to
          basket.
        </div>
      )}

      {/* Promotional Banners Carousel/Grid */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 p-5 text-white shadow-xs">
          <span className="rounded-md bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            Daily Essentials
          </span>
          <h2 className="mt-2 text-xl font-black">Morning Fresh Harvest</h2>
          <p className="mt-1 text-xs text-amber-50">
            Local farm vegetables, milk &amp; bakery goods ready for breakfast slots.
          </p>
          <Link
            href="/c/fruits-vegetables"
            className="mt-4 inline-block rounded-xl bg-white px-3.5 py-1.5 text-xs font-bold text-amber-900 shadow-xs hover:bg-amber-50 min-h-[44px] flex items-center"
          >
            Shop Fresh Produce →
          </Link>
        </div>

        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-teal-600 to-emerald-600 p-5 text-white shadow-xs">
          <span className="rounded-md bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
            Super Saver
          </span>
          <h2 className="mt-2 text-xl font-black">Kitchen Staples &amp; Grains</h2>
          <p className="mt-1 text-xs text-teal-50">
            Rice, atta, edible oils &amp; dals at community-exclusive wholesale prices.
          </p>
          <Link
            href="/c/staples"
            className="mt-4 inline-block rounded-xl bg-white px-3.5 py-1.5 text-xs font-bold text-teal-900 shadow-xs hover:bg-teal-50 min-h-[44px] flex items-center"
          >
            Shop Pantry Staples →
          </Link>
        </div>
      </section>

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
              The Munder Fresh Promise
            </span>
            <h2 className="mt-1 text-xl sm:text-2xl font-black text-slate-900">
              Why Hyperlocal Residential Delivery?
            </h2>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 leading-relaxed">
              We partner directly with residential societies to fulfill orders from dedicated local
              hubs. Scheduled slots mean predictable arrivals, and live store inventory means what
              you see in the catalogue reflects what's actually on the shelf.
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
