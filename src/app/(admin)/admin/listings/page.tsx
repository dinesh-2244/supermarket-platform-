import { requirePrincipal } from '@/auth';
import { listStores } from '@/modules/stores';
import { listPriceHistory } from '@/modules/pricing';
import { formatDateTime, formatPaise, listingRows, resolveStoreId } from '@/modules/admin';
import { setListedAction, setPriceAction } from '../actions';
import { ActionForm, Check, Field, Hidden } from '../form';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

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
      <>
        <PageHeading title="Listings & prices" />
        <Empty>You are not assigned to a store.</Empty>
      </>
    );
  }

  const rows = await listingRows(principal, storeId);

  // The append-only history for whichever listing was opened.
  const openId = typeof params.history === 'string' ? params.history : null;
  const history = openId === null ? [] : await listPriceHistory(principal, openId, 20);

  return (
    <>
      <PageHeading
        title="Listings & prices"
        subtitle="Per store, independent. Every change writes a PriceChange row in the same transaction."
      />
      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/listings" />

      <Card title={`${String(rows.length)} listing(s)`}>
        {rows.length === 0 ? (
          <Empty>Nothing is priced for this store yet.</Empty>
        ) : (
          <Table head={['SKU', 'Product', 'MRP', 'Selling', 'Discount', 'Listed', 'Edit price']}>
            {rows.map(({ listing, product, discountBp: discount }) => (
              <tr key={listing.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3 font-mono text-xs">{product?.sku ?? '—'}</td>
                <td className="py-2 pr-3">
                  {product?.name ?? listing.productId}
                  <a
                    className="ml-2 text-xs text-slate-500 underline"
                    href={`/admin/listings?store=${storeId}&history=${listing.id}`}
                  >
                    history
                  </a>
                </td>
                <td className="py-2 pr-3">{formatPaise(listing.mrpPaise)}</td>
                <td className="py-2 pr-3 font-semibold">
                  {formatPaise(listing.sellingPricePaise)}
                </td>
                <td className="py-2 pr-3">{(discount / 100).toFixed(1)}%</td>
                <td className="py-2 pr-3">
                  <ActionForm action={setListedAction} submitLabel="Save">
                    <Hidden name="storeId" value={storeId} />
                    <Hidden name="productId" value={listing.productId} />
                    <Check label="Listed" name="isListed" defaultChecked={listing.isListed} />
                  </ActionForm>
                </td>
                <td className="py-2 pr-3">
                  <ActionForm action={setPriceAction} submitLabel="Set price">
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

      {openId === null ? null : (
        <Card title="Price history">
          {history.length === 0 ? (
            <Empty>No changes recorded.</Empty>
          ) : (
            <Table head={['When', 'Selling', 'MRP', 'Reason']}>
              {history.map((change) => (
                <tr key={change.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 text-slate-500">{formatDateTime(change.createdAt)}</td>
                  <td className="py-2 pr-3">
                    {formatPaise(change.oldSellingPricePaise)} →{' '}
                    {formatPaise(change.newSellingPricePaise)}
                  </td>
                  <td className="py-2 pr-3">
                    {formatPaise(change.oldMrpPaise)} → {formatPaise(change.newMrpPaise)}
                  </td>
                  <td className="py-2 pr-3">{change.reason ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
