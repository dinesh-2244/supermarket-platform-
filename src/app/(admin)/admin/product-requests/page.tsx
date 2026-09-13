import React from 'react';
import Link from 'next/link';
import { requirePrincipal } from '@/auth';
import { adminHref, resolveStoreId } from '@/modules/admin';
import {
  getProductRequest,
  listProductRequests,
  productRequestCounts,
  PRODUCT_REQUEST_STATUSES,
  REQUEST_TRANSITIONS,
  type ProductRequestStatus,
} from '@/modules/product-requests';
import { listStores } from '@/modules/stores';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from '../ui';
import { ProductRequestStatusBadge } from './status-badge';
import { ProductRequestTriageForm } from './triage-form';

export const dynamic = 'force-dynamic';

function isValidStatus(val: unknown): val is ProductRequestStatus {
  return typeof val === 'string' && (PRODUCT_REQUEST_STATUSES as readonly string[]).includes(val);
}

export default async function ProductRequestsAdminPage({
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
        <PageHeading title="Product Requests" />
        <Empty title="No Store Assigned">You are not assigned to a store.</Empty>
      </div>
    );
  }

  const selectedStatusRaw = typeof params.status === 'string' ? params.status : undefined;
  const filterStatus = isValidStatus(selectedStatusRaw) ? selectedStatusRaw : undefined;

  const [counts, requests] = await Promise.all([
    productRequestCounts(principal, storeId),
    listProductRequests(
      principal,
      storeId,
      filterStatus ? { statuses: [filterStatus], limit: 200 } : { limit: 200 },
    ),
  ]);

  const activeStore = stores.find((s) => s.id === storeId);
  const timeZone = activeStore?.timezone ?? 'Asia/Kolkata';

  // Detail drawer
  const openId =
    typeof params.requestId === 'string'
      ? params.requestId
      : typeof params.id === 'string'
        ? params.id
        : null;

  const detail = openId ? await getProductRequest(principal, openId).catch(() => null) : null;

  const canManage =
    principal.kind === 'user' &&
    (principal.role === 'SUPER_ADMIN' ||
      (principal.role === 'STORE_MANAGER' && principal.storeId === storeId));

  const baseFilterHref = (status?: ProductRequestStatus) => {
    const base = status ? `/admin/product-requests?status=${status}` : '/admin/product-requests';
    return adminHref(base, storeId);
  };

  return (
    <div className="space-y-6">
      <PageHeading
        title="Product Requests"
        subtitle="Customer product requests awaiting triage, procurement planning, and fulfillment."
      />

      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/product-requests" />

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={baseFilterHref(undefined)}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shadow-2xs ${
            filterStatus === undefined
              ? 'bg-slate-900 text-white'
              : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <span>All requests</span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
              filterStatus === undefined ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {counts.total}
          </span>
        </Link>

        {PRODUCT_REQUEST_STATUSES.map((status) => {
          const isSelected = filterStatus === status;
          const count = counts.byStatus[status];
          return (
            <Link
              key={status}
              href={baseFilterHref(status)}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition shadow-2xs ${
                isSelected
                  ? 'bg-slate-900 text-white'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span>{status}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                  isSelected ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Detail / Triage Drawer */}
      {detail ? (
        <Card
          title={`Triage Request: ${detail.productName}`}
          subtitle={`Submitted on ${new Date(detail.createdAt).toLocaleDateString('en-IN', {
            timeZone,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}`}
        >
          <div className="space-y-6">
            {/* Header & Status */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Current Status:
                </span>
                <ProductRequestStatusBadge status={detail.status} />
              </div>
              <Link
                href={baseFilterHref(filterStatus)}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
              >
                ✕ Close drawer
              </Link>
            </div>

            {/* Request Snapshot Details */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 rounded-2xl bg-slate-50 p-4 sm:p-6 text-xs">
              <div>
                <dt className="font-bold text-slate-700">Product Name</dt>
                <dd className="mt-1 font-semibold text-slate-900 text-sm">{detail.productName}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-700">Brand</dt>
                <dd className="mt-1 text-slate-600">{detail.brand ?? '—'}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-700">Pack Size</dt>
                <dd className="mt-1 text-slate-600">{detail.packSize ?? '—'}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-700">Customer Name</dt>
                <dd className="mt-1 text-slate-600">
                  {detail.customerName ?? 'Guest / Anonymous'}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-slate-700">Customer Phone</dt>
                <dd className="mt-1 text-slate-600">{detail.customerPhone ?? 'None provided'}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-700">Community Store</dt>
                <dd className="mt-1 text-slate-600">
                  {activeStore ? `${activeStore.code} · ${activeStore.name}` : detail.storeId}
                </dd>
              </div>
              {detail.note ? (
                <div className="sm:col-span-2 lg:col-span-3 border-t border-slate-200/80 pt-3 mt-1">
                  <dt className="font-bold text-slate-700">Customer Note</dt>
                  <dd className="mt-1 text-slate-800 italic bg-white p-2.5 rounded-xl border border-slate-200/70">
                    “{detail.note}”
                  </dd>
                </div>
              ) : null}
            </div>

            {/* Status History Timeline */}
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                Status History Trail ({detail.history.length} event(s))
              </h4>
              <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold uppercase">
                    <tr>
                      <th className="py-2.5 px-4">From</th>
                      <th className="py-2.5 px-4">To</th>
                      <th className="py-2.5 px-4">Actor</th>
                      <th className="py-2.5 px-4">Timestamp</th>
                      <th className="py-2.5 px-4">Note / Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detail.history.map((h, index) => (
                      <tr
                        key={`${h.toStatus}-${String(index)}-${h.createdAt.toISOString()}`}
                        className="hover:bg-slate-50/50"
                      >
                        <td className="py-2.5 px-4 text-slate-500 font-medium">
                          {h.fromStatus ? (
                            <ProductRequestStatusBadge status={h.fromStatus} />
                          ) : (
                            '— (New)'
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          <ProductRequestStatusBadge status={h.toStatus} />
                        </td>
                        <td className="py-2.5 px-4 font-mono text-slate-600">{h.actorType}</td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {new Date(h.createdAt).toLocaleDateString('en-IN', {
                            timeZone,
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">
                          {h.note ? <span className="italic">{h.note}</span> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Triage Action Section */}
            <div className="border-t border-slate-100 pt-5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3">
                Triage Action
              </h4>
              {canManage ? (
                <ProductRequestTriageForm
                  requestId={detail.id}
                  currentStatus={detail.status}
                  allowedTransitions={REQUEST_TRANSITIONS[detail.status]}
                />
              ) : (
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs font-semibold text-amber-900">
                  Store Manager or Super Admin role required to triage requests.
                </div>
              )}
            </div>
          </div>
        </Card>
      ) : null}

      {/* Main Table */}
      <Card
        title={
          filterStatus
            ? `${String(counts.byStatus[filterStatus])} request(s) (${filterStatus})`
            : `${String(counts.total)} total request(s)`
        }
        subtitle="Shopper requests organized by submission date."
      >
        {requests.length === 0 ? (
          <Empty title="No Product Requests">
            {filterStatus
              ? `No requests currently in ${filterStatus} status for this shop.`
              : 'No shopper product requests recorded for this shop yet.'}
          </Empty>
        ) : (
          <Table head={['Product', 'Community', 'Customer', 'Requested At', 'Status', 'Actions']}>
            {requests.map((req) => {
              const detailUrl = adminHref(
                `/admin/product-requests?requestId=${req.id}${filterStatus ? `&status=${filterStatus}` : ''}`,
                storeId,
              );
              return (
                <tr key={req.id} className="hover:bg-slate-50/60 transition">
                  {/* Product */}
                  <td className="py-3 px-4">
                    <div className="font-bold text-slate-900">{req.productName}</div>
                    {req.brand || req.packSize ? (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {[req.brand, req.packSize].filter(Boolean).join(' · ')}
                      </div>
                    ) : null}
                    {req.note ? (
                      <div className="text-xs text-slate-400 italic line-clamp-1 mt-0.5 max-w-xs">
                        “{req.note}”
                      </div>
                    ) : null}
                  </td>

                  {/* Community */}
                  <td className="py-3 px-4 text-xs font-medium text-slate-700">
                    {activeStore ? (
                      <div>
                        <span className="font-bold text-slate-900">{activeStore.code}</span>
                        <span className="text-slate-500 ml-1">· {activeStore.name}</span>
                      </div>
                    ) : (
                      req.storeId
                    )}
                  </td>

                  {/* Customer */}
                  <td className="py-3 px-4 text-xs">
                    <div className="font-semibold text-slate-900">
                      {req.customerName ?? 'Guest'}
                    </div>
                    {req.customerPhone ? (
                      <div className="text-slate-500 font-mono mt-0.5">{req.customerPhone}</div>
                    ) : (
                      <div className="text-slate-400 italic mt-0.5">No phone</div>
                    )}
                  </td>

                  {/* Requested At */}
                  <td className="py-3 px-4 text-xs text-slate-600 whitespace-nowrap">
                    {new Date(req.createdAt).toLocaleDateString('en-IN', {
                      timeZone,
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>

                  {/* Status */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <ProductRequestStatusBadge status={req.status} />
                  </td>

                  {/* Actions */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <Link
                      href={detailUrl}
                      className="inline-flex min-h-[44px] items-center text-xs font-bold text-emerald-800 hover:text-emerald-950 underline px-1"
                    >
                      Triage / Details →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </div>
  );
}
