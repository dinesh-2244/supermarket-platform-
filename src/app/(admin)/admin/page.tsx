import Link from 'next/link';
import { requirePrincipal } from '@/auth';
import { adminHref, formatDateTime, orderQueue, overview, resolveStoreId } from '@/modules/admin';
import { hasTotpEnrolled } from '@/modules/identity';
import { changePasswordAction } from './actions';
import { ActionForm, Field } from './form';
import { Card, Empty, PageHeading, StatCard, StoreSwitcher, Table } from './ui';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const requested = typeof params.store === 'string' ? params.store : undefined;

  const twoFactor = await hasTotpEnrolled(principal);
  const data = await overview(principal, null);
  const storeId = resolveStoreId(principal, requested, data.stores);
  const view = storeId === data.storeId ? data : await overview(principal, storeId);

  // Fetch actionable orders for the active store (AD1 / AD9 authoritative read path)
  const orders =
    view.storeId !== null ? await orderQueue(principal, view.storeId).catch(() => null) : null;
  const actionableOrderCount = orders?.rows.length ?? 0;

  const activeStore = view.stores.find((s) => s.id === view.storeId) ?? view.stores[0];

  return (
    <div className="space-y-6">
      <PageHeading
        title="Overview"
        subtitle="What the back office is looking after right now."
        badge={
          activeStore !== undefined ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800 border border-slate-200 shadow-2xs">
              <span
                className={`h-2 w-2 rounded-full ${
                  activeStore.isActive ? 'bg-emerald-600 animate-pulse' : 'bg-slate-400'
                }`}
              />
              {activeStore.code} &middot; {activeStore.name}
              {!activeStore.isActive && ' (inactive)'}
            </span>
          ) : undefined
        }
      />

      <StoreSwitcher stores={view.stores} storeId={view.storeId} basePath="/admin" />

      {/* KPI Grid (AD1) */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Actionable orders"
          value={actionableOrderCount}
          subtitle="Awaiting store action"
          href={adminHref('/admin/orders', view.storeId)}
          urgency={actionableOrderCount > 0 ? 'amber' : 'default'}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
              />
            </svg>
          }
        />

        <StatCard
          label="Low stock items"
          value={view.lowStock.items.length}
          subtitle={`At or below ${String(view.lowStock.threshold)} units`}
          href={adminHref('/admin/inventory', view.storeId)}
          urgency={view.lowStock.items.length > 0 ? 'rose' : 'default'}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          }
        />

        <StatCard
          label="Listed products"
          value={view.listedCount}
          subtitle={`In active store (${view.productCount} master)`}
          href={adminHref('/admin/listings', view.storeId)}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
          }
        />

        <StatCard
          label="Operating stores"
          value={view.stores.filter((s) => s.isActive).length}
          subtitle="Active community fulfillment hubs"
          href={adminHref('/admin/stores', view.storeId)}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          }
        />
      </div>

      {/* Actionable Low Stock Table */}
      <Card
        title={`Low stock (at or below ${String(view.lowStock.threshold)})`}
        subtitle="Items requiring replenishment or supplier reorder."
        badge={
          view.lowStock.items.length > 0 ? (
            <span className="rounded-full bg-rose-100 border border-rose-200 px-2.5 py-0.5 text-xs font-bold text-rose-900">
              {view.lowStock.items.length} urgent
            </span>
          ) : (
            <span className="rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-900">
              All stocked
            </span>
          )
        }
        action={
          <Link
            href={adminHref('/admin/inventory', view.storeId)}
            className="inline-flex min-h-[44px] items-center gap-1 text-xs font-bold text-emerald-800 hover:text-emerald-900"
          >
            Manage inventory &rarr;
          </Link>
        }
      >
        {view.lowStock.items.length === 0 ? (
          <Empty title="Healthy inventory">Nothing is running low in this store.</Empty>
        ) : (
          <Table head={['Product id', 'Website stock', 'Last counted']}>
            {view.lowStock.items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50/60 transition">
                <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-900">
                  {item.productId}
                </td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center rounded-md bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-900">
                    {item.websiteStock} left
                  </span>
                </td>
                <td className="py-3 px-4 text-xs text-slate-500 font-medium">
                  {formatDateTime(item.lastCountedAt)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Account and Security Section (Demoted per AD1) */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Two-factor authentication">
          <p className="mb-4 text-xs sm:text-sm text-slate-600 leading-relaxed">
            {twoFactor
              ? 'On — signing in asks for a code from your authenticator app.'
              : 'Off — your password alone signs you in. Recommended for super admins.'}
          </p>
          <Link
            href={adminHref('/admin/two-factor', view.storeId)}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs sm:text-sm font-bold text-slate-800 shadow-2xs hover:bg-slate-50 active:scale-[0.99] transition"
          >
            {twoFactor ? 'Manage two-factor authentication' : 'Set up two-factor authentication'}
          </Link>
        </Card>

        <Card title="Change my password">
          <ActionForm action={changePasswordAction} submitLabel="Change password">
            <Field label="Current password" name="current" type="password" required />
            <Field label="New password" name="next" type="password" required />
          </ActionForm>
        </Card>
      </div>
    </div>
  );
}
