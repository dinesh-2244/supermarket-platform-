'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { adminHref, RoleBadge } from './ui';

interface NavGroup {
  readonly title: string;
  readonly items: readonly {
    readonly href: string;
    readonly label: string;
    readonly icon: React.ReactNode;
    readonly badge?: string;
  }[];
}

const NAV_GROUPS: readonly NavGroup[] = [
  {
    title: 'Operations',
    items: [
      {
        href: '/admin',
        label: 'Overview',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
            />
          </svg>
        ),
      },
      {
        href: '/admin/orders',
        label: 'Orders',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
            />
          </svg>
        ),
      },
      {
        href: '/admin/inventory',
        label: 'Inventory',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Catalog & Merchandising',
    items: [
      {
        href: '/admin/listings',
        label: 'Listings & prices',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
        ),
      },
      {
        href: '/admin/products',
        label: 'Products',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
            />
          </svg>
        ),
      },
      {
        href: '/admin/categories',
        label: 'Categories',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M4 6h16M4 10h16M4 14h16M4 18h16"
            />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Delivery & Stores',
    items: [
      {
        href: '/admin/zones',
        label: 'Delivery areas',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        ),
      },
      {
        href: '/admin/stores',
        label: 'Stores & settings',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
            />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Administration & Reports',
    items: [
      {
        href: '/admin/users',
        label: 'Users',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
            />
          </svg>
        ),
      },
      {
        href: '/admin/audit',
        label: 'Audit log',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        ),
      },
      {
        href: '/admin/reports',
        label: 'Reports & KPIs',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
        ),
      },
      {
        href: '/admin/two-factor',
        label: 'Two-factor auth',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Reserved IA Slots',
    items: [
      {
        href: '/admin/fulfillment',
        label: 'Fulfillment',
        badge: 'Phase 5',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
            />
          </svg>
        ),
      },
      {
        href: '/admin/pos',
        label: 'POS Integration',
        badge: 'ADR-0007',
        icon: (
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
        ),
      },
    ],
  },
];

export function AdminNavShell({
  role,
  allowedHrefs,
  children,
  signOutForm,
}: {
  role: 'SUPER_ADMIN' | 'STORE_MANAGER' | 'STORE_STAFF';
  allowedHrefs: readonly string[];
  children: React.ReactNode;
  signOutForm: React.ReactNode;
}): React.ReactElement {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();
  const allowedSet = new Set(allowedHrefs);

  const handleNavigate = () => {
    if (mobileNavOpen) setMobileNavOpen(false);
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 flex flex-col md:flex-row">
      {/* Mobile / Tablet Header */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden shadow-2xs">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileNavOpen((prev) => !prev)}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            aria-label="Toggle navigation menu"
            aria-expanded={mobileNavOpen}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={mobileNavOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}
              />
            </svg>
          </button>
          <div>
            <span className="text-base font-black tracking-tight text-slate-900 block leading-tight">
              MunderFresh
            </span>
            <span className="text-xs font-semibold text-emerald-800">Back Office</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RoleBadge role={role} />
        </div>
      </header>

      {/* Sidebar Navigation */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 transform bg-slate-900 text-slate-100 transition-transform duration-200 ease-in-out md:static md:translate-x-0 flex flex-col shrink-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand header */}
        <div className="flex items-center justify-between border-b border-slate-800/80 px-6 py-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white font-black text-base shadow-sm">
                M
              </span>
              <span className="text-lg font-black tracking-tight text-white">MunderFresh</span>
            </div>
            <p className="mt-1 text-xs text-slate-400 font-medium">Store Operations & Admin</p>
          </div>
          <button
            type="button"
            onClick={() => setMobileNavOpen(false)}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white md:hidden"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Current User Pill */}
        <div className="mx-4 my-3 rounded-xl border border-slate-800 bg-slate-800/50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400">Signed in as</span>
            <RoleBadge role={role} />
          </div>
        </div>

        {/* Nav Links */}
        <Suspense
          fallback={
            <NavLinksContent
              groups={NAV_GROUPS}
              allowedSet={allowedSet}
              pathname={pathname}
              currentStore={null}
              onNavigate={handleNavigate}
            />
          }
        >
          <NavLinksWithStore
            groups={NAV_GROUPS}
            allowedSet={allowedSet}
            pathname={pathname}
            onNavigate={handleNavigate}
          />
        </Suspense>

        {/* Sign Out Footer */}
        <div className="border-t border-slate-800 p-4">{signOutForm}</div>
      </aside>

      {/* Backdrop for mobile drawer */}
      {mobileNavOpen ? (
        <div
          onClick={() => setMobileNavOpen(false)}
          className="fixed inset-0 z-30 bg-slate-950/50 backdrop-blur-xs md:hidden"
          aria-hidden="true"
        />
      ) : null}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 px-4 py-6 sm:px-8 sm:py-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function NavLinksWithStore({
  groups,
  allowedSet,
  pathname,
  onNavigate,
}: {
  groups: readonly NavGroup[];
  allowedSet: Set<string>;
  pathname: string;
  onNavigate: () => void;
}): React.ReactElement {
  const searchParams = useSearchParams();
  const currentStore = searchParams.get('store');
  return (
    <NavLinksContent
      groups={groups}
      allowedSet={allowedSet}
      pathname={pathname}
      currentStore={currentStore}
      onNavigate={onNavigate}
    />
  );
}

function NavLinksContent({
  groups,
  allowedSet,
  pathname,
  currentStore,
  onNavigate,
}: {
  groups: readonly NavGroup[];
  allowedSet: Set<string>;
  pathname: string;
  currentStore: string | null;
  onNavigate: () => void;
}): React.ReactElement {
  const getHref = (href: string) => adminHref(href, currentStore);

  return (
    <nav className="flex-1 overflow-y-auto px-4 py-2 space-y-5" aria-label="Back office navigation">
      {groups.map((group) => {
        // Strictly role-gated per navigationFor(principal.role) — zero client-side exceptions (M4)
        const visibleItems = group.items.filter((item) => allowedSet.has(item.href));

        if (visibleItems.length === 0) return null;

        return (
          <div key={group.title}>
            <h3 className="px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {group.title}
            </h3>
            <ul className="mt-1.5 space-y-1">
              {visibleItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={getHref(item.href)}
                      onClick={onNavigate}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex min-h-[44px] items-center justify-between rounded-xl px-3 py-2 text-sm font-semibold transition ${
                        isActive
                          ? 'bg-emerald-700 text-white shadow-xs'
                          : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={isActive ? 'text-white' : 'text-slate-400'}>
                          {item.icon}
                        </span>
                        <span>{item.label}</span>
                      </div>
                      {item.badge !== undefined ? (
                        <span className="rounded-md bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[10px] font-bold text-slate-300">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
