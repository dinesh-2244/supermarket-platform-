import Link from 'next/link';
import type { OrderStatus } from '@/modules/orders';

/**
 * Modern UI primitives for MunderFresh back office (AD1–AD12).
 * Designed for desktop density and tablet-first staff ergonomics.
 */

export function PageHeading({
  title,
  subtitle,
  badge,
  action,
}: {
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/80 pb-5">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">{title}</h1>
          {badge}
        </div>
        {subtitle !== undefined ? (
          <p className="mt-1 text-sm text-slate-500 font-medium">{subtitle}</p>
        ) : null}
      </div>
      {action !== undefined ? (
        <div className="flex items-center gap-2.5 shrink-0">{action}</div>
      ) : null}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  badge,
  action,
  children,
  className,
}: {
  title?: string;
  subtitle?: string;
  badge?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <section
      className={`mb-6 rounded-2xl sm:rounded-3xl border border-slate-200/90 bg-white p-5 sm:p-7 shadow-xs ${
        className ?? ''
      }`}
    >
      {title !== undefined ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-base sm:text-lg font-bold text-slate-900">{title}</h2>
              {badge}
            </div>
            {subtitle !== undefined ? (
              <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
            ) : null}
          </div>
          {action !== undefined ? <div>{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  subtitle,
  icon,
  href,
  urgency = 'default',
}: {
  label: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  href?: string;
  urgency?: 'default' | 'amber' | 'emerald' | 'rose';
}): React.ReactElement {
  const urgencyStyles = {
    default: 'border-slate-200/90 bg-white hover:border-slate-300',
    amber: 'border-amber-200 bg-amber-50/50 hover:border-amber-300',
    emerald: 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300',
    rose: 'border-rose-200 bg-rose-50/50 hover:border-rose-300',
  };

  const content = (
    <div
      className={`relative rounded-2xl sm:rounded-3xl border p-5 shadow-xs transition-all ${urgencyStyles[urgency]} ${
        href !== undefined ? 'cursor-pointer hover:shadow-sm active:scale-[0.99]' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</span>
          <div className="mt-1 text-2xl sm:text-3xl font-black text-slate-900">{value}</div>
          {subtitle !== undefined ? (
            <div className="mt-1 text-xs font-medium text-slate-500">{subtitle}</div>
          ) : null}
        </div>
        {icon !== undefined ? (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            {icon}
          </div>
        ) : null}
      </div>
      {href !== undefined ? (
        <span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-emerald-800 hover:text-emerald-900">
          View details &rarr;
        </span>
      ) : null}
    </div>
  );

  if (href !== undefined) {
    return <Link href={href}>{content}</Link>;
  }
  return content;
}

export function Table({
  head,
  children,
  className,
}: {
  head: readonly string[];
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <div
      className={`overflow-x-auto rounded-2xl border border-slate-200/90 bg-white shadow-xs ${className ?? ''}`}
    >
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
            {head.map((cell) => (
              <th key={cell} className="py-3 px-4">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({
  children,
  title = 'No records found',
}: {
  children: React.ReactNode;
  title?: string;
}): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300/80 bg-slate-50/50 p-8 text-center my-4">
      <svg
        className="h-10 w-10 text-slate-400 mb-2"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
        />
      </svg>
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      <p className="mt-1 text-xs text-slate-500 max-w-sm">{children}</p>
    </div>
  );
}

/** Store picker. Prominent selector for SUPER_ADMIN, honest fixed store badge for scoped staff. */
export function StoreSwitcher({
  stores,
  storeId,
  basePath,
}: {
  stores: readonly { id: string; code: string; name: string }[];
  storeId: string | null;
  basePath: string;
}): React.ReactElement | null {
  if (stores.length <= 1) {
    const onlyStore = stores[0];
    if (onlyStore === undefined) return null;
    return (
      <div className="mb-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs">
        <span className="h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-emerald-100" />
        <span>
          {onlyStore.code} &middot; {onlyStore.name}
        </span>
      </div>
    );
  }

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <span className="text-xs font-bold text-slate-500 mr-1">Store view:</span>
      {stores.map((store) => {
        const isSelected = store.id === storeId;
        return (
          <Link
            key={store.id}
            href={`${basePath}?store=${store.id}`}
            aria-current={isSelected ? 'page' : undefined}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition shadow-2xs active:scale-[0.99] ${
              isSelected
                ? 'border border-emerald-800 bg-emerald-800 text-white'
                : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${isSelected ? 'bg-white' : 'bg-slate-400'}`} />
            {store.code} &middot; {store.name}
          </Link>
        );
      })}
    </div>
  );
}

/** Server-action result banner. */
export function Notice({ message }: { message: string | undefined }): React.ReactElement | null {
  if (message === undefined || message === '') return null;
  const isError = message.startsWith('!');
  return (
    <div
      role="status"
      className={`mb-4 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold shadow-2xs ${
        isError
          ? 'border-rose-200 bg-rose-50 text-rose-900'
          : 'border-emerald-200 bg-emerald-50 text-emerald-950'
      }`}
    >
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black ${
          isError ? 'bg-rose-200 text-rose-900' : 'bg-emerald-200 text-emerald-900'
        }`}
        aria-hidden="true"
      >
        {isError ? '!' : '✓'}
      </span>
      <span>{isError ? message.slice(1) : message}</span>
    </div>
  );
}

export const ORDER_STATUS_STYLES: Readonly<Record<OrderStatus, string>> = {
  PLACED: 'bg-amber-100 text-amber-900 border-amber-300',
  ACCEPTED: 'bg-sky-100 text-sky-900 border-sky-300',
  PICKING: 'bg-indigo-100 text-indigo-900 border-indigo-300',
  PICKED: 'bg-purple-100 text-purple-900 border-purple-300',
  BILLED_IN_POS: 'bg-blue-100 text-blue-900 border-blue-300',
  PACKED: 'bg-teal-100 text-teal-900 border-teal-300',
  OUT_FOR_DELIVERY: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  DELIVERED: 'bg-green-100 text-green-900 border-green-300',
  CLOSED: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  CANCELLED_BY_STORE: 'bg-rose-100 text-rose-900 border-rose-300',
  DELIVERY_FAILED: 'bg-orange-100 text-orange-900 border-orange-300',
  CLOSED_UNDELIVERED: 'bg-rose-50 text-rose-800 border-rose-200',
};

/** Accessible Order Status Badges matching the 12 state-machine states. */
export function OrderStatusBadge({ status }: { status: OrderStatus }): React.ReactElement {
  const className = ORDER_STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-800 border-slate-300';

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${className}`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}

/** Role badge. */
export function RoleBadge({ role }: { role: string }): React.ReactElement {
  const isSuper = role === 'SUPER_ADMIN';
  const isManager = role === 'STORE_MANAGER';

  const style = isSuper
    ? 'bg-purple-100 text-purple-900 border-purple-200'
    : isManager
      ? 'bg-emerald-100 text-emerald-900 border-emerald-200'
      : 'bg-blue-100 text-blue-900 border-blue-200';

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${style}`}
    >
      {role.replace(/_/g, ' ').toLowerCase()}
    </span>
  );
}
