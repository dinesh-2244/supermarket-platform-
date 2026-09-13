import Link from 'next/link';
import { cartItemCount } from '@/modules/cart';
import { getStore } from '@/modules/stores';
import {
  currentCartToken,
  currentCustomer,
  currentStoreContext,
  storefrontPrincipal,
} from '@/storefront';
import { clearAreaAction } from './actions';
import { communityNameForStore, STORE_COMMUNITIES } from './communities';
import { STOREFRONT_COPY_MANIFEST } from './copy-manifest';
import { MobileCartBar } from './mobile-cart-bar';

/**
 * The redesigned storefront shell (D1, D2, D5).
 *
 * Features:
 * - Prominent Store Community Selector in the header
 * - Universal Header Search Bar embedded across all storefront pages (D5)
 * - Thumb-friendly mobile layout with accessible tap targets (≥44px)
 * - Clear basket status with live item count
 */
export default async function StorefrontLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const context = await currentStoreContext();
  const store =
    context === null
      ? null
      : await getStore(storefrontPrincipal(context), context.serviceability.storeId);
  const basketCount = await cartItemCount(await currentCartToken());
  const customer = await currentCustomer();

  const communityName = communityNameForStore(store);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased overflow-x-hidden">
      {/* Top Banner & Header */}
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/95 backdrop-blur shadow-xs">
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          {/* Main Header Row */}
          <div className="flex flex-wrap items-center justify-between gap-x-1.5 sm:gap-x-4 gap-y-2 py-2 sm:py-3.5">
            {/* Brand Logo */}
            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
              <Link
                href="/"
                className="flex items-center gap-1.5 sm:gap-2 shrink-0"
                aria-label="Munder Fresh Home"
              >
                <span className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-xl bg-emerald-700 text-white font-black text-sm sm:text-lg shadow-xs">
                  M
                </span>
                <span className="text-sm sm:text-xl font-extrabold tracking-tight text-slate-900">
                  Munder<span className="text-emerald-700">Fresh</span>
                </span>
              </Link>
            </div>

            {/* Navigation Right: Shop, About, Basket, Account */}
            <nav className="flex items-center gap-0.5 sm:gap-3 shrink-0 order-2 sm:order-3">
              <Link
                href="/shop"
                className="inline-flex text-xs font-semibold text-slate-700 hover:text-emerald-800 px-1.5 sm:px-2 py-1.5 rounded-lg hover:bg-slate-100 transition min-h-[44px] items-center"
              >
                Shop
              </Link>

              <Link
                href="/about"
                className="inline-flex text-xs font-semibold text-slate-700 hover:text-emerald-800 px-1.5 sm:px-2 py-1.5 rounded-lg hover:bg-slate-100 transition min-h-[44px] items-center"
              >
                About
              </Link>

              <Link
                href="/contact"
                className="inline-flex text-xs font-semibold text-slate-700 hover:text-emerald-800 px-1.5 sm:px-2 py-1.5 rounded-lg hover:bg-slate-100 transition min-h-[44px] items-center"
              >
                Contact
              </Link>

              <Link
                href="/cart"
                className="relative inline-flex items-center gap-1 rounded-full bg-emerald-700 px-2.5 sm:px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 transition min-h-[44px]"
                aria-label={`Basket${basketCount > 0 ? ` (${basketCount})` : ''}`}
              >
                <svg
                  className="w-4 h-4 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
                  />
                </svg>
                <span className="hidden sm:inline">Basket</span>
                <span className="sr-only sm:hidden">Basket</span>
                {basketCount === 0 ? null : (
                  <span
                    className="ml-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-white px-1 text-[11px] font-bold text-emerald-800"
                    aria-label={`${String(basketCount)} item(s) in your basket`}
                  >
                    {basketCount}
                  </span>
                )}
              </Link>

              <Link
                href="/account"
                className="inline-flex items-center text-xs font-medium text-slate-600 hover:text-slate-900 px-1.5 sm:px-2 py-2 min-h-[44px]"
              >
                {customer === null ? 'Sign in' : 'Account'}
              </Link>
            </nav>

            {/* Desktop Universal Search Bar (D5) */}
            <div className="hidden md:flex flex-1 max-w-sm lg:max-w-md mx-2 order-2">
              <form action="/search" method="get" className="w-full relative">
                <input
                  type="search"
                  name="q"
                  placeholder="Search fresh vegetables, milk, atta, fruits..."
                  className="w-full rounded-full border border-slate-300 bg-slate-50/70 py-2 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600/20 transition"
                  aria-label="Search grocery catalogue"
                />
                <div className="absolute inset-y-0 left-0 flex items-center pl-3.5 pointer-events-none text-slate-400">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                </div>
              </form>
            </div>

            {/* Community Selector Header Control (D2) */}
            {/* On mobile (< sm): wraps cleanly as full-width delivery bar, avoiding overlap with logo and basket */}
            {/* On desktop (sm+): sits next to logo */}
            <div className="order-3 sm:order-1 w-full sm:w-auto min-w-0">
              {context === null ? (
                <Link
                  href="/store/select"
                  className="inline-flex w-full sm:w-auto items-center justify-between sm:justify-start gap-1.5 rounded-xl sm:rounded-full bg-emerald-50 px-3 py-2 sm:py-1.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-600/20 hover:bg-emerald-100 transition min-h-[44px] sm:min-h-0"
                  aria-label="Select delivery community"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="text-emerald-700 shrink-0">📍</span>
                    <span className="truncate">Select Community</span>
                  </span>
                  <span className="text-emerald-700 text-xs font-bold shrink-0">Choose ▼</span>
                </Link>
              ) : (
                <form action={clearAreaAction} className="w-full sm:w-auto">
                  <button
                    type="submit"
                    className="inline-flex w-full sm:w-auto items-center justify-between sm:justify-start gap-1.5 rounded-xl sm:rounded-full bg-slate-100 px-3 py-2 sm:py-1.5 text-left text-xs font-medium text-slate-800 hover:bg-slate-200/80 transition min-h-[44px] sm:min-h-0"
                    aria-label="Change delivery area"
                    title="Click to switch community or store"
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-emerald-700 shrink-0">📍</span>
                      <span className="text-slate-500 hidden sm:inline shrink-0">
                        Delivering to:
                      </span>
                      <span className="font-semibold text-slate-900 truncate max-w-[200px] sm:max-w-[160px] lg:max-w-[220px]">
                        {communityName}
                      </span>
                    </span>
                    <span className="text-emerald-700 sm:text-slate-400 text-xs sm:text-[10px] shrink-0">
                      ▼
                    </span>
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Mobile Search Bar Row (D5 - Thumb Zone) */}
          <div className="pb-2.5 md:hidden">
            <form action="/search" method="get" className="relative w-full">
              <input
                type="search"
                name="q"
                placeholder="Search fresh vegetables, dairy, atta..."
                className="w-full rounded-xl border border-slate-300 bg-slate-50/80 py-2 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:bg-white focus:outline-none min-h-[44px]"
                aria-label="Search grocery catalogue"
              />
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
            </form>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        className={`flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-5 sm:py-7 ${
          basketCount > 0 ? 'pb-28 sm:pb-28' : ''
        }`}
      >
        {children}
      </main>

      {/* Footer */}
      <footer
        className={`mt-auto border-t border-slate-200 bg-white ${
          basketCount > 0 ? 'pb-28 sm:pb-28' : ''
        }`}
        style={
          basketCount > 0
            ? { paddingBottom: 'calc(6.5rem + env(safe-area-inset-bottom, 0px))' }
            : undefined
        }
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-700 text-white font-black text-sm">
                  M
                </span>
                <span className="text-base font-extrabold tracking-tight text-slate-900">
                  Munder<span className="text-emerald-700">Fresh</span>
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-500 leading-relaxed">
                {STOREFRONT_COPY_MANIFEST.footer.brandDescription}
              </p>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                {STOREFRONT_COPY_MANIFEST.footer.communitiesHeading}
              </h3>
              <ul className="mt-3 space-y-2 text-xs text-slate-600">
                {STORE_COMMUNITIES.map((community) => (
                  <li key={community.id}>
                    <Link href="/store/select" className="hover:text-emerald-800">
                      {community.name}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    href="/unserviceable"
                    className="text-emerald-700 font-medium hover:underline"
                  >
                    {STOREFRONT_COPY_MANIFEST.footer.unserviceableLink}
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Shopping & Orders
              </h3>
              <ul className="mt-3 space-y-2 text-xs text-slate-600">
                <li>
                  <Link href="/shop" className="hover:text-emerald-800">
                    Browse All Products
                  </Link>
                </li>
                <li>
                  <Link href="/about" className="hover:text-emerald-800 font-medium">
                    About Munder Fresh
                  </Link>
                </li>
                <li>
                  <Link href="/cart" className="hover:text-emerald-800">
                    Your Basket
                  </Link>
                </li>
                <li>
                  <Link href="/account" className="hover:text-emerald-800">
                    Account & Past Orders
                  </Link>
                </li>
                <li>
                  <Link href="/contact" className="hover:text-emerald-800">
                    Contact Us
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                {STOREFRONT_COPY_MANIFEST.footer.commitmentsTitle}
              </h3>
              <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                {STOREFRONT_COPY_MANIFEST.footer.commitmentsDescription}
              </p>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-100 pt-6 text-center text-xs text-slate-400">
            © {new Date().getFullYear()} Munder Fresh Supermarket Platform. All rights reserved.
          </div>
        </div>
      </footer>

      {/* Floating Mobile Cart Summary (D7) */}
      <MobileCartBar basketCount={basketCount} />
    </div>
  );
}
