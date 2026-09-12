import Link from 'next/link';
import { requirePrincipal } from '@/auth';
import { listCategories, listProductImages, listProducts, searchProducts } from '@/modules/catalog';
import { adminHref } from '@/modules/admin';
import {
  addProductImageAction,
  createProductAction,
  editProductAction,
  moveProductImageAction,
  removeProductImageAction,
  updateProductAction,
} from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * The shared global master (R1 / ADR-0003): one row per real product, used by
 * every store. A store manager can read this screen but not write it.
 */
export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const storeId = typeof params.store === 'string' ? params.store : null;
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

  const openId = typeof params.edit === 'string' ? params.edit : null;
  const openProduct = openId === null ? undefined : products.find((p) => p.id === openId);
  const images = openId === null ? [] : await listProductImages(principal, openId);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Products"
        subtitle="The shared catalogue master — one row per real product, used by both stores."
      />

      <Card title="Search">
        <form method="get" className="flex flex-wrap items-end gap-3">
          {storeId !== null ? <input type="hidden" name="store" value={storeId} /> : null}
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">Name or brand (typos tolerated)</span>
            <input
              name="q"
              defaultValue={query}
              placeholder="Search products..."
              className="min-h-[44px] w-72 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none placeholder:text-slate-400"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800 transition active:scale-[0.99]"
          >
            Search
          </button>
          {query !== '' ? (
            <Link
              href={adminHref('/admin/products', storeId)}
              className="inline-flex min-h-[44px] items-center text-xs font-semibold text-slate-500 underline hover:text-slate-900 px-2"
            >
              clear
            </Link>
          ) : null}
        </form>
      </Card>

      {canWrite ? (
        <Card title="Add a product" subtitle="Create a new shared master SKU in the catalog.">
          <ActionForm
            action={createProductAction}
            submitLabel="Add product"
            className="flex flex-wrap items-end gap-3"
          >
            <Field label="SKU / barcode" name="sku" required />
            <Field label="Name" name="name" required width="w-52" />
            <Field label="Brand" name="brand" />
            <Field label="Pack size" name="packSize" required width="w-28" />
            <Select label="Category" name="categoryId" options={categoryOptions} width="w-44" />
          </ActionForm>
        </Card>
      ) : null}

      {canWrite && openProduct !== undefined ? (
        <Card
          title={`Edit ${openProduct.name}`}
          subtitle="Modify master product details and manage image showcase gallery."
        >
          <ActionForm
            action={editProductAction}
            submitLabel="Save product"
            className="flex flex-wrap items-end gap-3"
          >
            <Hidden name="productId" value={openProduct.id} />
            <Field label="Name" name="name" defaultValue={openProduct.name} required width="w-52" />
            <Field label="Brand" name="brand" defaultValue={openProduct.brand ?? ''} />
            <Field
              label="Pack size"
              name="packSize"
              defaultValue={openProduct.packSize}
              required
              width="w-28"
            />
            <Select
              label="Category"
              name="categoryId"
              options={categoryOptions}
              defaultValue={openProduct.categoryId}
              width="w-44"
            />
          </ActionForm>

          <div className="mt-6 border-t border-slate-100 pt-4">
            <h3 className="mb-3 text-sm font-bold text-slate-900">Product Images</h3>
            {images.length === 0 ? (
              <Empty title="No images uploaded">No images added for this product yet.</Empty>
            ) : (
              <Table head={['Order', 'URL', 'Alt', 'Move', 'Remove']}>
                {images.map((image, index) => (
                  <tr key={image.id} className="hover:bg-slate-50/60 transition">
                    <td className="py-3 px-4 font-bold text-slate-700">{index + 1}</td>
                    <td className="py-3 px-4 font-mono text-xs break-all max-w-xs">{image.url}</td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-600">
                      {image.alt ?? '—'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex gap-2">
                        <ActionForm action={moveProductImageAction} submitLabel="Up">
                          <Hidden name="productId" value={openProduct.id} />
                          <Hidden name="imageId" value={image.id} />
                          <Hidden name="direction" value="up" />
                        </ActionForm>
                        <ActionForm action={moveProductImageAction} submitLabel="Down">
                          <Hidden name="productId" value={openProduct.id} />
                          <Hidden name="imageId" value={image.id} />
                          <Hidden name="direction" value="down" />
                        </ActionForm>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <ActionForm
                        action={removeProductImageAction}
                        submitLabel="Remove"
                        submitButtonClassName="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-rose-50 border border-rose-200 px-3 py-1.5 text-xs font-bold text-rose-800 hover:bg-rose-100 transition"
                      >
                        <Hidden name="imageId" value={image.id} />
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
            <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200/80 p-4">
              <h4 className="text-xs font-bold text-slate-700 mb-2">Upload or link image</h4>
              <ActionForm
                action={addProductImageAction}
                submitLabel="Add image"
                className="flex flex-wrap items-end gap-3"
              >
                <Hidden name="productId" value={openProduct.id} />
                <Field
                  label="Image URL"
                  name="url"
                  required
                  width="w-80"
                  placeholder="https://images.example/photo.jpg"
                />
                <Field label="Alt text" name="alt" width="w-48" placeholder="Front packaging" />
              </ActionForm>
            </div>
          </div>
        </Card>
      ) : null}

      <Card
        title={`${String(products.length)} product(s)`}
        subtitle="Shared catalog items across all stores."
      >
        {products.length === 0 ? (
          <Empty title="No matching products">Nothing matched your search filter.</Empty>
        ) : (
          <Table head={['SKU', 'Name', 'Brand', 'Pack', 'Category', canWrite ? 'Active' : '']}>
            {products.map((product) => (
              <tr key={product.id} className="hover:bg-slate-50/60 transition">
                <td className="py-3 px-4 font-mono text-xs font-bold text-slate-700">
                  {product.sku}
                </td>
                <td className="py-3 px-4">
                  <span className="font-bold text-slate-900">{product.name}</span>
                  {product.isActive ? null : (
                    <span className="ml-2 inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                      inactive
                    </span>
                  )}
                </td>
                <td className="py-3 px-4 text-xs font-medium text-slate-600">
                  {product.brand ?? '—'}
                </td>
                <td className="py-3 px-4 text-xs font-semibold text-slate-800">
                  {product.packSize}
                </td>
                <td className="py-3 px-4 text-xs font-medium text-slate-600">
                  {categoryName.get(product.categoryId) ?? '—'}
                </td>
                <td className="py-3 px-4">
                  {canWrite ? (
                    <div className="flex items-center gap-3">
                      <ActionForm
                        action={updateProductAction}
                        submitLabel="Save"
                        className="flex items-center gap-2"
                      >
                        <Hidden name="productId" value={product.id} />
                        <Check label="Active" name="isActive" defaultChecked={product.isActive} />
                      </ActionForm>
                      <Link
                        className="inline-flex min-h-[44px] items-center px-2 text-xs font-bold text-emerald-800 underline hover:text-emerald-950"
                        href={adminHref(
                          `/admin/products?edit=${product.id}${query === '' ? '' : `&q=${encodeURIComponent(query)}`}`,
                          storeId,
                        )}
                      >
                        edit
                      </Link>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
