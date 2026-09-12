import Link from 'next/link';
import { requirePrincipal } from '@/auth';
import { listStores } from '@/modules/stores';
import { ACTIONABLE_ORDER_STATUSES, orderQueue, overview, resolveStoreId } from '@/modules/admin';
import type { OrderStatus } from '@/modules/orders';
import { Card, Empty, OrderStatusBadge, PageHeading, StatCard, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Reports & Operational KPIs (AD9).
 *
 * Guardrail compliance:
 * Every number displayed traces directly to authoritative backend read paths
 * (modules/admin: overview, orderQueue). No fabricated aggregates or client-side
 * cross-store rollups.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const stores = await listStores(principal);
  const storeId = resolveStoreId(
    principal,
    typeof params.store === 'string' ? params.store : undefined,
    stores,
  );

  if (storeId === null) {
    return (
      <div className="space-y-6">
        <PageHeading
          title="Reports & KPIs"
          subtitle="Store-level operational analytics and order pipeline distribution."
        />
        <Empty title="No Store Assigned">You are not assigned to a store.</Empty>
      </div>
    );
  }

  const [data, queue] = await Promise.all([
    overview(principal, storeId),
    orderQueue(principal, storeId, { all: true }),
  ]);

  const activeStore = stores.find((s) => s.id === storeId) ?? stores[0];

  // Group orders by status using existing QueueRow data
  const statusCounts = new Map<OrderStatus, number>();
  let flaggedVarianceCount = 0;

  for (const row of queue.rows) {
    statusCounts.set(row.status, (statusCounts.get(row.status) ?? 0) + 1);
    if (row.priceVarianceFlagged) flaggedVarianceCount++;
  }

  const statusList = Array.from(statusCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Reports & KPIs"
        subtitle="Store-level operational analytics and order pipeline distribution."
        badge={
          activeStore !== undefined ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900 border border-emerald-200">
              {activeStore.code} &middot; {activeStore.name}
            </span>
          ) : undefined
        }
      />

      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/reports" />

      {/* Primary KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total store orders"
          value={queue.rows.length}
          subtitle="All recorded orders in store history"
          href={`/admin/orders?store=${storeId}&all=1`}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
              />
            </svg>
          }
        />

        <StatCard
          label="Price variances"
          value={flaggedVarianceCount}
          subtitle="Orders requiring manager/customer check"
          href={`/admin/orders?store=${storeId}`}
          urgency={flaggedVarianceCount > 0 ? 'amber' : 'default'}
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
          label="Low stock threshold"
          value={data.lowStock.items.length}
          subtitle={`Items at or under ${String(data.lowStock.threshold)} units`}
          href={`/admin/inventory?store=${storeId}`}
          urgency={data.lowStock.items.length > 0 ? 'rose' : 'emerald'}
          icon={
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
              />
            </svg>
          }
        />

        <StatCard
          label="Store catalog coverage"
          value={`${data.listedCount} / ${data.productCount}`}
          subtitle={`${data.categoryCount} master categories active`}
          href={`/admin/listings?store=${storeId}`}
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
      </div>

      {/* Order Pipeline Status Breakdown */}
      <Card
        title="Order pipeline breakdown"
        subtitle="Distribution of all orders across the 12 lifecycle states."
        action={
          <Link
            href={`/admin/orders?store=${storeId}`}
            className="inline-flex min-h-[44px] items-center text-xs font-bold text-emerald-800 underline hover:text-emerald-950"
          >
            Open orders queue &rarr;
          </Link>
        }
      >
        {statusList.length === 0 ? (
          <Empty title="No order activity">This store has not recorded any orders yet.</Empty>
        ) : (
          <Table head={['Order status', 'Orders count', 'Share of total', 'Pipeline role']}>
            {statusList.map(([status, count]) => {
              const percentage = ((count / queue.rows.length) * 100).toFixed(1);
              const isActionable = ACTIONABLE_ORDER_STATUSES.includes(status);
              const isTerminal = !isActionable;
              return (
                <tr key={status} className="hover:bg-slate-50/60 transition">
                  <td className="py-3 px-4">
                    <OrderStatusBadge status={status} />
                  </td>
                  <td className="py-3 px-4 font-black text-slate-900 text-base">{count}</td>
                  <td className="py-3 px-4 text-xs font-medium text-slate-600">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span>{percentage}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-xs font-semibold">
                    {isTerminal ? (
                      <span className="text-slate-400">Terminal archive</span>
                    ) : (
                      <span className="text-emerald-800 font-bold">Active operational queue</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>

      {/* Stock Health Summary */}
      <Card
        title="Stock health"
        subtitle="Catalog inventory status and replenishment warnings."
        action={
          <Link
            href={`/admin/inventory?store=${storeId}`}
            className="inline-flex min-h-[44px] items-center text-xs font-bold text-emerald-800 underline hover:text-emerald-950"
          >
            Manage stock &rarr;
          </Link>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/50 p-5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Low-stock alerts
            </span>
            <div className="mt-2 text-2xl font-black text-slate-900">
              {data.lowStock.items.length} items
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Products at or below the store threshold of {String(data.lowStock.threshold)} units.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200/90 bg-slate-50/50 p-5">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Store catalog adoption
            </span>
            <div className="mt-2 text-2xl font-black text-slate-900">
              {((data.listedCount / (data.productCount || 1)) * 100).toFixed(0)}%
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {data.listedCount} of {data.productCount} master products listed and priced.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
