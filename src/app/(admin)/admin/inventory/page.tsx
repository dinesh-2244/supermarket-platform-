import Link from 'next/link';
import { requirePrincipal } from '@/auth';
import { listStores } from '@/modules/stores';
import { listImportHistory, listLedger, listLowStock, STOCK_REASONS } from '@/modules/inventory';
import { adminHref, formatDateTime, formatDelta, resolveStoreId, stockRows } from '@/modules/admin';
import { adjustStockAction, importStockAction, reconcileStockAction } from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, StatCard, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Back-office inventory management (AD5).
 * Real-time website stock tracking, manual adjustments, stock reconciliation,
 * atomic CSV import, and append-only ledger history.
 */
export default async function InventoryPage({
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
        <PageHeading title="Inventory" />
        <Empty title="No Store Assigned">You are not assigned to a store.</Empty>
      </div>
    );
  }

  const focusProduct = typeof params.product === 'string' ? params.product : null;

  // Ledger filters
  const one = (key: string): string => {
    const value = params[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const reason = one('reason');
  const actor = one('actor');
  const from = one('from');
  const to = one('to');

  const reasonFilter = STOCK_REASONS.find((candidate) => candidate === reason);
  const fromDate = from === '' ? undefined : new Date(from);
  const toDate = to === '' ? undefined : new Date(`${to}T23:59:59.999Z`);

  const [rows, low, ledger, imports] = await Promise.all([
    stockRows(principal, storeId),
    listLowStock(principal, storeId),
    listLedger(principal, {
      storeId,
      ...(focusProduct === null ? {} : { productId: focusProduct }),
      ...(reasonFilter === undefined ? {} : { reasons: [reasonFilter] }),
      ...(actor === '' ? {} : { actorId: actor }),
      ...(fromDate === undefined || Number.isNaN(fromDate.getTime()) ? {} : { from: fromDate }),
      ...(toDate === undefined || Number.isNaN(toDate.getTime()) ? {} : { to: toDate }),
      limit: 50,
    }),
    listImportHistory(principal, storeId, 10),
  ]);

  const nameByProduct = new Map(rows.map((row) => [row.item.productId, row.product?.name]));

  return (
    <div className="space-y-6">
      <PageHeading
        title="Inventory"
        subtitle="Website stock. Every change writes a StockLedger row in the same transaction (§7)."
      />

      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/inventory" />

      {/* KPI Overview */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Tracked products"
          value={rows.length}
          subtitle="Inventory lines in this store"
        />
        <StatCard
          label="Low stock items"
          value={low.items.length}
          subtitle={`At or below threshold (${String(low.threshold)})`}
          urgency={low.items.length > 0 ? 'rose' : 'emerald'}
        />
        <StatCard
          label="Recent ledger movements"
          value={ledger.length}
          subtitle="In audit record"
        />
      </div>

      {/* Import Stock from CSV (AD12 Manual Mode Supported) */}
      <Card
        title="Import stock from CSV"
        subtitle="Upload stock files for bulk set or delta adjustments. Atomic validation prevents partial imports."
      >
        <ActionForm
          action={importStockAction}
          submitLabel="Run import"
          className="flex flex-wrap items-end gap-3"
        >
          <Hidden name="storeId" value={storeId} />
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">CSV file</span>
            <input
              name="file"
              type="file"
              accept=".csv,text/csv"
              className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-slate-900 file:text-white hover:file:bg-slate-800"
            />
          </label>
          <Select
            label="Default mode"
            name="mode"
            options={[
              { value: 'set', label: 'set (absolute)' },
              { value: 'delta', label: 'delta (add/subtract)' },
            ]}
          />
          <Check label="Dry run" name="dryRun" defaultChecked />
        </ActionForm>
        <p className="mt-3 rounded-xl bg-slate-50 border border-slate-200/80 p-3 text-xs text-slate-600 leading-relaxed">
          Required headers: <code>sku</code> and <code>quantity</code>, optionally <code>mode</code>
          . Every row is validated before any is applied &mdash; one invalid SKU or bad quantity
          rejects the whole file without writing.
        </p>
      </Card>

      {/* Low Stock Urgency Card */}
      <Card
        title={`Low stock (at or below ${String(low.threshold)})`}
        badge={
          low.items.length > 0 ? (
            <span className="rounded-full bg-rose-100 border border-rose-200 px-2.5 py-0.5 text-xs font-bold text-rose-900">
              {low.items.length} urgent
            </span>
          ) : undefined
        }
      >
        {low.items.length === 0 ? (
          <Empty title="Stock levels healthy">Nothing is running low in this store.</Empty>
        ) : (
          <Table head={['Product', 'Stock', 'Last counted']}>
            {low.items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50/60 transition">
                <td className="py-3 px-4 font-semibold text-slate-900">
                  {nameByProduct.get(item.productId) ?? item.productId}
                </td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center rounded-md bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-900">
                    {item.websiteStock} left
                  </span>
                </td>
                <td className="py-3 px-4 text-xs font-medium text-slate-500">
                  {formatDateTime(item.lastCountedAt)}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* All Items Table */}
      <Card
        title={`${String(rows.length)} item(s)`}
        subtitle="Real-time website stock levels with quick adjustment controls."
      >
        {rows.length === 0 ? (
          <Empty title="No items found">No stock rows for this store yet.</Empty>
        ) : (
          <Table head={['SKU', 'Product', 'Stock', 'Last counted', 'Adjust', 'Reconcile']}>
            {rows.map(({ item, product }) => (
              <tr key={item.id} className="hover:bg-slate-50/60 transition align-top">
                <td className="py-3 px-4 font-mono text-xs font-bold text-slate-700">
                  {product?.sku ?? '—'}
                </td>
                <td className="py-3 px-4">
                  <div className="font-bold text-slate-900">{product?.name ?? item.productId}</div>
                  <Link
                    className="inline-flex min-h-[44px] items-center text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
                    href={adminHref(`/admin/inventory?product=${item.productId}`, storeId)}
                  >
                    View ledger history &rarr;
                  </Link>
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-black ${
                      item.websiteStock <= low.threshold
                        ? 'bg-rose-100 text-rose-900'
                        : 'bg-emerald-100 text-emerald-950'
                    }`}
                  >
                    {item.websiteStock}
                  </span>
                </td>
                <td className="py-3 px-4 text-xs font-medium text-slate-500">
                  {formatDateTime(item.lastCountedAt)}
                </td>
                <td className="py-3 px-4">
                  <ActionForm
                    action={adjustStockAction}
                    submitLabel="Adjust"
                    className="flex flex-wrap items-end gap-2"
                  >
                    <Hidden name="storeId" value={storeId} />
                    <Hidden name="productId" value={item.productId} />
                    <Field label="Change by" name="delta" type="number" width="w-24" />
                    <Field label="Note" name="note" width="w-32" />
                  </ActionForm>
                </td>
                <td className="py-3 px-4">
                  <ActionForm
                    action={reconcileStockAction}
                    submitLabel="Reconcile"
                    className="flex flex-wrap items-end gap-2"
                  >
                    <Hidden name="storeId" value={storeId} />
                    <Hidden name="productId" value={item.productId} />
                    <Field label="Counted" name="counted" type="number" width="w-24" />
                    <Field label="Note" name="note" width="w-32" />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Ledger Movements */}
      <Card title={focusProduct === null ? 'Recent movements' : 'Movements for this product'}>
        <form
          method="get"
          className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl bg-slate-50 border border-slate-200/80 p-4"
        >
          <input type="hidden" name="store" value={storeId} />
          {focusProduct === null ? null : (
            <input type="hidden" name="product" value={focusProduct} />
          )}
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">Reason</span>
            <select
              name="reason"
              defaultValue={reason}
              className="min-h-[44px] w-44 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
            >
              <option value="">any</option>
              {STOCK_REASONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">From</span>
            <input
              name="from"
              type="date"
              defaultValue={from}
              className="min-h-[44px] w-36 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">To</span>
            <input
              name="to"
              type="date"
              defaultValue={to}
              className="min-h-[44px] w-36 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">Actor id</span>
            <input
              name="actor"
              defaultValue={actor}
              className="min-h-[44px] w-64 rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800 transition active:scale-[0.99]"
          >
            Filter
          </button>
          <Link
            className="inline-flex min-h-[44px] items-center text-xs font-semibold text-slate-500 hover:text-slate-900 underline px-2"
            href={adminHref('/admin/inventory', storeId)}
          >
            clear
          </Link>
        </form>

        {ledger.length === 0 ? (
          <Empty title="No movements found">No movements recorded matching current filters.</Empty>
        ) : (
          <Table head={['When', 'Product', 'Change', 'Balance after', 'Reason', 'Note']}>
            {ledger.map((entry) => (
              <tr key={entry.id} className="hover:bg-slate-50/60 transition">
                <td className="py-3 px-4 text-xs font-medium text-slate-500">
                  {formatDateTime(entry.createdAt)}
                </td>
                <td className="py-3 px-4 font-semibold text-slate-900">
                  {nameByProduct.get(entry.productId) ?? entry.productId}
                </td>
                <td className="py-3 px-4 font-mono font-bold">
                  <span
                    className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs ${
                      entry.delta < 0
                        ? 'bg-rose-100 text-rose-900'
                        : 'bg-emerald-100 text-emerald-900'
                    }`}
                  >
                    {formatDelta(entry.delta)}
                  </span>
                </td>
                <td className="py-3 px-4 font-black text-slate-900">{entry.balanceAfter}</td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-xs font-bold text-slate-800">
                    {entry.reason}
                  </span>
                </td>
                <td className="py-3 px-4 text-xs font-medium text-slate-600">
                  {entry.note ?? '—'}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Import History */}
      <Card title="Import history" subtitle="Past CSV file batches processed for this store.">
        {imports.length === 0 ? (
          <Empty title="No imports yet">
            No CSV import jobs have been submitted for this store.
          </Empty>
        ) : (
          <Table head={['When', 'File', 'Mode', 'Outcome', 'Rows', 'Applied', 'Errors', 'Report']}>
            {imports.map((run) => (
              <tr key={run.id} className="hover:bg-slate-50/60 transition">
                <td className="py-3 px-4 text-xs font-medium text-slate-500">
                  {formatDateTime(run.createdAt)}
                </td>
                <td className="py-3 px-4 font-mono text-xs font-bold text-slate-800">
                  {run.filename}
                </td>
                <td className="py-3 px-4 text-xs font-bold uppercase text-slate-600">{run.mode}</td>
                <td className="py-3 px-4">
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                      run.outcome === 'rejected'
                        ? 'bg-rose-100 text-rose-900 border-rose-300'
                        : run.outcome === 'dry_run'
                          ? 'bg-sky-100 text-sky-900 border-sky-300'
                          : 'bg-emerald-100 text-emerald-900 border-emerald-300'
                    }`}
                  >
                    {run.outcome}
                  </span>
                </td>
                <td className="py-3 px-4 font-semibold">{run.rowCount}</td>
                <td className="py-3 px-4 font-semibold text-emerald-900">{run.appliedCount}</td>
                <td className="py-3 px-4 font-semibold text-rose-800">{run.errorCount}</td>
                <td className="py-3 px-4">
                  {run.errorCount > 0 ? (
                    <a
                      className="inline-flex min-h-[44px] items-center text-xs font-bold text-rose-700 underline hover:text-rose-900"
                      href={`/admin/inventory/import/${run.id}`}
                      download
                    >
                      Download errors &darr;
                    </a>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
