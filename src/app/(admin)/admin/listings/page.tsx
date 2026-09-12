import Link from 'next/link';
import { requirePrincipal } from '@/auth';
import { listStores } from '@/modules/stores';
import { listProducts } from '@/modules/catalog';
import { listPriceHistory } from '@/modules/pricing';
import {
  adminHref,
  formatDateTime,
  formatPaise,
  listingRows,
  resolveStoreId,
} from '@/modules/admin';
import { setListedAction, setPriceAction } from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Back-office listings & pricing management (AD6).
 * Per-store independent pricing, MRP discounts, listed toggles, and append-only price history.
 */
export default async function ListingsPage({
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
        <PageHeading title="Listings & prices" />
        <Empty title="No Store Assigned">You are not assigned to a store.</Empty>
      </div>
    );
  }

  const rows = await listingRows(principal, storeId);

  const listed = new Set(rows.map((row) => row.listing.productId));
  const unlisted = (await listProducts(principal, { limit: 500 })).filter(
    (product) => !listed.has(product.id),
  );

  const openId = typeof params.history === 'string' ? params.history : null;
  const history = openId === null ? [] : await listPriceHistory(principal, openId, 20);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Listings & prices"
        subtitle="Per store, independent. Every change writes a PriceChange row in the same transaction."
      />

      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/listings" />

      {/* Add Product to Store */}
      <Card
        title="Add a product to this store"
        subtitle="Assign an initial selling price to a master product to enable it in this store."
      >
        {unlisted.length === 0 ? (
          <Empty title="All products listed">
            Every active product in the catalog already has a price in this store.
          </Empty>
        ) : (
          <ActionForm
            action={setPriceAction}
            submitLabel="Set first price"
            className="flex flex-wrap items-end gap-3"
          >
            <Hidden name="storeId" value={storeId} />
            <Select
              label="Product"
              name="productId"
              width="w-72"
              options={unlisted.map((product) => ({
                value: product.id,
                label: `${product.sku} · ${product.name}`,
              }))}
            />
            <Field label="MRP (paise)" name="mrpPaise" type="number" width="w-28" />
            <Field label="Selling (paise)" name="sellingPricePaise" type="number" width="w-28" />
            <Field label="Reason" name="reason" width="w-36" placeholder="Initial store listing" />
          </ActionForm>
        )}
      </Card>

      {/* Store Listings Table */}
      <Card
        title={`${String(rows.length)} listing(s)`}
        subtitle="Catalog items available for customer purchase in this store."
      >
        {rows.length === 0 ? (
          <Empty title="No products priced">Nothing is priced for this store yet.</Empty>
        ) : (
          <Table head={['SKU', 'Product', 'MRP', 'Selling', 'Discount', 'Listed', 'Edit price']}>
            {rows.map(({ listing, product, discountBp: discount }) => (
              <tr key={listing.id} className="hover:bg-slate-50/60 transition align-top">
                <td className="py-3 px-4 font-mono text-xs font-bold text-slate-700">
                  {product?.sku ?? '—'}
                </td>
                <td className="py-3 px-4">
                  <div className="font-bold text-slate-900">
                    {product?.name ?? listing.productId}
                  </div>
                  <Link
                    className="inline-flex min-h-[44px] items-center text-xs font-semibold text-emerald-800 underline hover:text-emerald-950"
                    href={adminHref(`/admin/listings?history=${listing.id}`, storeId)}
                  >
                    View price history &rarr;
                  </Link>
                </td>
                <td className="py-3 px-4 text-xs font-medium text-slate-500">
                  {formatPaise(listing.mrpPaise)}
                </td>
                <td className="py-3 px-4 font-black text-slate-900">
                  {formatPaise(listing.sellingPricePaise)}
                </td>
                <td className="py-3 px-4">
                  {discount > 0 ? (
                    <span className="inline-flex items-center rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-900">
                      {(discount / 100).toFixed(0)}% OFF
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">0%</span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <ActionForm
                    action={setListedAction}
                    submitLabel="Save"
                    className="flex items-center gap-2"
                  >
                    <Hidden name="storeId" value={storeId} />
                    <Hidden name="productId" value={listing.productId} />
                    <Check label="Listed" name="isListed" defaultChecked={listing.isListed} />
                  </ActionForm>
                </td>
                <td className="py-3 px-4">
                  <ActionForm
                    action={setPriceAction}
                    submitLabel="Set price"
                    className="flex flex-wrap items-end gap-2"
                  >
                    <Hidden name="storeId" value={storeId} />
                    <Hidden name="productId" value={listing.productId} />
                    <Field
                      label="MRP (paise)"
                      name="mrpPaise"
                      type="number"
                      defaultValue={listing.mrpPaise}
                      width="w-28"
                    />
                    <Field
                      label="Selling (paise)"
                      name="sellingPricePaise"
                      type="number"
                      defaultValue={listing.sellingPricePaise}
                      width="w-28"
                    />
                    <Field label="Reason" name="reason" width="w-32" />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {/* Price History Drawer/Card */}
      {openId === null ? null : (
        <Card
          title="Price history"
          subtitle="Audit trail of previous price adjustments for this item."
        >
          {history.length === 0 ? (
            <Empty title="No prior changes">No price changes recorded yet.</Empty>
          ) : (
            <Table head={['When', 'Selling price shift', 'MRP shift', 'Reason']}>
              {history.map((change) => (
                <tr key={change.id} className="hover:bg-slate-50/60 transition">
                  <td className="py-3 px-4 text-xs font-medium text-slate-500">
                    {formatDateTime(change.createdAt)}
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-900">
                    {formatPaise(change.oldSellingPricePaise)} &rarr;{' '}
                    <span className="font-bold text-emerald-800">
                      {formatPaise(change.newSellingPricePaise)}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-xs text-slate-600">
                    {formatPaise(change.oldMrpPaise)} &rarr; {formatPaise(change.newMrpPaise)}
                  </td>
                  <td className="py-3 px-4 text-xs font-medium text-slate-600">
                    {change.reason ?? '—'}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}
