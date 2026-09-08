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

/**
 * The storefront shell (arch §9).
 *
 * The header names the area the visitor picked and the store serving it, so
 * "which shop am I looking at, and at whose prices?" is answerable from every
 * page. That question has a wrong answer available — the other store's — which
 * is why the label is read from the freshly resolved context rather than from
 * anything the page was passed.
 *
 * There is deliberately **no guard here**. Browsing requires no account and no
 * area: a visitor with neither still gets the shell, and each page decides for
 * itself whether it needs a store context. Redirecting from the layout would
 * make the locality picker unreachable, which is the mistake the admin sign-in
 * page already taught us once.
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <Link href="/" className="text-base font-semibold">
            Munder Fresh
          </Link>

          <nav className="flex flex-wrap gap-3 text-sm">
            <Link href="/search" className="text-slate-600 hover:text-slate-900">
              Search
            </Link>
            <Link href="/cart" className="text-slate-600 hover:text-slate-900">
              Basket
              {basketCount === 0 ? null : (
                <span
                  className="ml-1 rounded-full bg-emerald-700 px-1.5 py-0.5 text-xs text-white"
                  aria-label={`${String(basketCount)} item(s) in your basket`}
                >
                  {basketCount}
                </span>
              )}
            </Link>
            <Link href="/account" className="text-slate-600 hover:text-slate-900">
              {customer === null ? 'Sign in' : 'Account'}
            </Link>
          </nav>

          <div className="ml-auto flex flex-wrap items-center gap-3 text-sm">
            {context === null ? (
              <Link href="/locality" className="text-emerald-800 underline">
                Choose your area
              </Link>
            ) : (
              <form action={clearAreaAction}>
                <button
                  type="submit"
                  className="rounded border border-slate-300 px-2 py-1 text-left text-xs"
                  aria-label="Change delivery area"
                >
                  <span className="block text-slate-500">Delivering to</span>
                  <span className="block font-medium text-slate-900">
                    {store?.name ?? 'your area'}
                  </span>
                </button>
              </form>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">{children}</main>

      <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-slate-500">
        Prices and availability are those of the store serving your area, and are confirmed again
        when you view your basket.
      </footer>
    </div>
  );
}
