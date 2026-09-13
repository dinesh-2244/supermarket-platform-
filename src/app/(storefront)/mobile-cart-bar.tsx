'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { STOREFRONT_COPY_MANIFEST } from './copy-manifest';

/**
 * Mobile-first sticky bottom cart bar (D7).
 * Provides one-tap thumb-friendly basket navigation when shopping on phones.
 * Automatically hidden on checkout and basket pages where it is redundant.
 */
export function MobileCartBar({ basketCount }: { basketCount: number }): React.ReactElement | null {
  const pathname = usePathname();

  if (basketCount <= 0) return null;
  // Suppress on basket, checkout, and order completion routes where it is redundant
  if (pathname === '/cart' || pathname === '/checkout' || pathname.startsWith('/order-')) {
    return null;
  }

  return (
    <aside
      aria-label="Floating basket summary"
      className="fixed bottom-3 inset-x-3 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96 z-50 animate-in fade-in slide-in-from-bottom-3 duration-200"
      style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex items-center justify-between rounded-2xl bg-emerald-900 px-4 py-2.5 text-white shadow-xl ring-1 ring-white/10">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-xs font-black">
            {basketCount}
          </span>
          <div className="truncate">
            <span className="block text-xs font-bold leading-tight truncate">
              {basketCount} {basketCount === 1 ? 'item' : 'items'} added
            </span>
            <span className="block text-[10px] text-emerald-200 font-medium">
              {STOREFRONT_COPY_MANIFEST.mobileCartBar.slotNotice}
            </span>
          </div>
        </div>

        <Link
          href="/cart"
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-emerald-950 hover:bg-emerald-400 active:scale-95 transition min-h-[44px] shrink-0"
        >
          <span>View Basket</span>
          <span>→</span>
        </Link>
      </div>
    </aside>
  );
}
