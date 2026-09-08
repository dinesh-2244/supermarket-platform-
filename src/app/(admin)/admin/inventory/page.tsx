import { requirePrincipal } from '@/auth';
import { listStores } from '@/modules/stores';
import { listImportHistory, listLedger, listLowStock, STOCK_REASONS } from '@/modules/inventory';
import { formatDateTime, formatDelta, resolveStoreId, stockRows } from '@/modules/admin';
import { adjustStockAction, importStockAction, reconcileStockAction } from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

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
      <>
        <PageHeading title="Inventory" />
        <Empty>You are not assigned to a store.</Empty>
      </>
    );
  }

  const focusProduct = typeof params.product === 'string' ? params.product : null;

  // Ledger filters (D5: "filter by reason / date range / actor").
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
    <>
      <PageHeading
        title="Inventory"
        subtitle="Website stock. Every change writes a StockLedger row in the same transaction (§7)."
      />
      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/inventory" />

      <Card title="Import stock from CSV">
        <ActionForm action={importStockAction} submitLabel="Run import">
          <Hidden name="storeId" value={storeId} />
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">CSV file</span>
            <input name="file" type="file" accept=".csv,text/csv" className="text-sm" />
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
        <p className="mt-2 text-xs text-slate-500">
          Header row with <code>sku</code> and <code>quantity</code>, optionally <code>mode</code>.
          Export from Excel as CSV. Every row is validated before any is applied — one bad row
          rejects the whole file and nothing is written.
        </p>
      </Card>

      <Card title={`Low stock (at or below ${String(low.threshold)})`}>
        {low.items.length === 0 ? (
          <Empty>Nothing is running low.</Empty>
        ) : (
          <Table head={['Product', 'Stock', 'Last counted']}>
            {low.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">{nameByProduct.get(item.productId) ?? item.productId}</td>
                <td className="py-2 pr-3 font-semibold text-red-700">{item.websiteStock}</td>
                <td className="py-2 pr-3 text-slate-500">{formatDateTime(item.lastCountedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title={`${String(rows.length)} item(s)`}>
        {rows.length === 0 ? (
          <Empty>No stock rows for this store yet.</Empty>
        ) : (
          <Table head={['SKU', 'Product', 'Stock', 'Last counted', 'Adjust', 'Reconcile']}>
            {rows.map(({ item, product }) => (
              <tr key={item.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3 font-mono text-xs">{product?.sku ?? '—'}</td>
                <td className="py-2 pr-3">
                  {product?.name ?? item.productId}
                  <a
                    className="ml-2 text-xs text-slate-500 underline"
                    href={`/admin/inventory?store=${storeId}&product=${item.productId}`}
                  >
                    ledger
                  </a>
                </td>
                <td className="py-2 pr-3 font-semibold">{item.websiteStock}</td>
                <td className="py-2 pr-3 text-slate-500">{formatDateTime(item.lastCountedAt)}</td>
                <td className="py-2 pr-3">
                  <ActionForm action={adjustStockAction} submitLabel="Adjust">
                    <Hidden name="storeId" value={storeId} />
                    <Hidden name="productId" value={item.productId} />
                    <Field label="Change by" name="delta" type="number" width="w-24" />
                    <Field label="Note" name="note" width="w-32" />
                  </ActionForm>
                </td>
                <td className="py-2 pr-3">
                  <ActionForm action={reconcileStockAction} submitLabel="Reconcile">
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

      <Card title={focusProduct === null ? 'Recent movements' : 'Movements for this product'}>
        <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="store" value={storeId} />
          {focusProduct === null ? null : (
            <input type="hidden" name="product" value={focusProduct} />
          )}
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Reason</span>
            <select
              name="reason"
              defaultValue={reason}
              className="w-44 rounded border border-slate-300 px-2 py-1 text-sm"
            >
              <option value="">any</option>
              {STOCK_REASONS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">From</span>
            <input
              name="from"
              type="date"
              defaultValue={from}
              className="w-36 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">To</span>
            <input
              name="to"
              type="date"
              defaultValue={to}
              className="w-36 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Actor id</span>
            <input
              name="actor"
              defaultValue={actor}
              className="w-64 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            Filter
          </button>
          <a
            className="pb-2 text-xs text-slate-500 underline"
            href={`/admin/inventory?store=${storeId}`}
          >
            clear
          </a>
        </form>
        {ledger.length === 0 ? (
          <Empty>No movements recorded.</Empty>
        ) : (
          <Table head={['When', 'Product', 'Change', 'Balance after', 'Reason', 'Note']}>
            {ledger.map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 text-slate-500">{formatDateTime(entry.createdAt)}</td>
                <td className="py-2 pr-3">
                  {nameByProduct.get(entry.productId) ?? entry.productId}
                </td>
                <td
                  className={`py-2 pr-3 font-mono ${entry.delta < 0 ? 'text-red-700' : 'text-green-700'}`}
                >
                  {formatDelta(entry.delta)}
                </td>
                <td className="py-2 pr-3 font-semibold">{entry.balanceAfter}</td>
                <td className="py-2 pr-3 text-xs">{entry.reason}</td>
                <td className="py-2 pr-3 text-xs text-slate-500">{entry.note ?? '—'}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Import history">
        {imports.length === 0 ? (
          <Empty>No imports yet.</Empty>
        ) : (
          <Table head={['When', 'File', 'Mode', 'Outcome', 'Rows', 'Applied', 'Errors', 'Report']}>
            {imports.map((run) => (
              <tr key={run.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 text-slate-500">{formatDateTime(run.createdAt)}</td>
                <td className="py-2 pr-3">{run.filename}</td>
                <td className="py-2 pr-3">{run.mode}</td>
                <td className={`py-2 pr-3 ${run.outcome === 'rejected' ? 'text-red-700' : ''}`}>
                  {run.outcome}
                </td>
                <td className="py-2 pr-3">{run.rowCount}</td>
                <td className="py-2 pr-3">{run.appliedCount}</td>
                <td className="py-2 pr-3">{run.errorCount}</td>
                <td className="py-2 pr-3">
                  {run.errorCount > 0 ? (
                    <a
                      className="text-xs underline"
                      href={`/admin/inventory/import/${run.id}`}
                      download
                    >
                      download errors
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
