import { requirePrincipal } from '@/auth';
import { listCategories, listProducts, searchProducts } from '@/modules/catalog';
import { createProductAction, updateProductAction } from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * The shared global master (R1 / ADR-0003): one row per real product, used by
 * every store. A store manager can read this screen but not write it — the forms
 * are shown only to a principal that could actually use them, and the server
 * action refuses regardless.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.trim() : '';

  const [categories, products] = await Promise.all([
    listCategories(principal),
    query === ''
      ? listProducts(principal, { includeInactive: true, limit: 200 })
      : searchProducts(principal, query, { includeInactive: true, limit: 200 }),
  ]);

  const canWrite = principal.kind === 'user' && principal.role === 'SUPER_ADMIN';
  const categoryOptions = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));
  const categoryName = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <>
      <PageHeading
        title="Products"
        subtitle="The shared catalogue master — one row per real product, used by both stores."
      />

      <Card title="Search">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Name or brand (typos tolerated)</span>
            <input
              name="q"
              defaultValue={query}
              className="w-64 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            Search
          </button>
        </form>
      </Card>

      {canWrite ? (
        <Card title="Add a product">
          <ActionForm action={createProductAction} submitLabel="Add product">
            <Field label="SKU / barcode" name="sku" required />
            <Field label="Name" name="name" required width="w-52" />
            <Field label="Brand" name="brand" />
            <Field label="Pack size" name="packSize" required width="w-28" />
            <Select label="Category" name="categoryId" options={categoryOptions} width="w-44" />
          </ActionForm>
        </Card>
      ) : null}

      <Card title={`${String(products.length)} product(s)`}>
        {products.length === 0 ? (
          <Empty>Nothing matched.</Empty>
        ) : (
          <Table head={['SKU', 'Name', 'Brand', 'Pack', 'Category', canWrite ? 'Active' : '']}>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-mono text-xs">{product.sku}</td>
                <td className="py-2 pr-3">
                  {product.name}
                  {product.isActive ? '' : ' (inactive)'}
                </td>
                <td className="py-2 pr-3">{product.brand ?? '—'}</td>
                <td className="py-2 pr-3">{product.packSize}</td>
                <td className="py-2 pr-3">{categoryName.get(product.categoryId) ?? '—'}</td>
                <td className="py-2 pr-3">
                  {canWrite ? (
                    <ActionForm action={updateProductAction} submitLabel="Save">
                      <Hidden name="productId" value={product.id} />
                      <Check label="Active" name="isActive" defaultChecked={product.isActive} />
                    </ActionForm>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
