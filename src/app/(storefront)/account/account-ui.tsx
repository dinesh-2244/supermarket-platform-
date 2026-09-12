import Link from 'next/link';

/**
 * Shared presentation primitives for the customer account area.
 *
 * Emphasizes our core project invariant:
 * Accounts are 100% OPTIONAL. Guest checkout is always available.
 */

export function AccountOptionalNotice({ className }: { className?: string }): React.ReactElement {
  return (
    <div
      className={
        className ??
        'rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-4 text-xs sm:text-sm text-emerald-950 flex items-start gap-3 shadow-xs'
      }
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 font-bold text-sm">
        ✓
      </div>
      <div className="space-y-0.5">
        <p className="font-bold text-emerald-900">An account is completely optional</p>
        <p className="text-emerald-800 leading-relaxed text-xs sm:text-sm">
          You can always browse, fill your basket, and check out as a guest without creating an
          account. An account is only needed if you want to save delivery addresses and keep your
          basket synced across devices.
        </p>
      </div>
    </div>
  );
}

export function AccountBackLink({
  href = '/account',
  label = 'Back to account',
}: {
  href?: string;
  label?: string;
}): React.ReactElement {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[44px] items-center gap-1.5 py-2 text-xs font-semibold text-emerald-800 hover:text-emerald-900 transition mb-4 group"
    >
      <span className="transition-transform group-hover:-translate-x-0.5">←</span>
      <span>{label}</span>
    </Link>
  );
}

export function AccountNavTabs({
  active,
}: {
  active: 'home' | 'addresses' | 'orders';
}): React.ReactElement {
  const tabs = [
    { id: 'home', label: 'Overview', href: '/account' },
    { id: 'addresses', label: 'Your addresses', href: '/account/addresses' },
    { id: 'orders', label: 'Your orders', href: '/account/orders' },
  ] as const;

  return (
    <nav className="flex flex-wrap gap-2 border-b border-slate-200 pb-3 mb-6">
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <Link
            key={tab.id}
            href={tab.href}
            className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition ${
              isActive
                ? 'bg-emerald-700 text-white shadow-xs'
                : 'bg-white border border-slate-200/90 text-slate-700 hover:bg-slate-50 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
