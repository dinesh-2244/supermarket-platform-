import { requirePrincipal } from '@/auth';
import { depthOf, listCategories } from '@/modules/catalog';
import { createCategoryAction, updateCategoryAction } from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, Table } from '../ui';

export const dynamic = 'force-dynamic';

/** The catalogue master is global, so this screen is `SUPER_ADMIN` only (AD6). */
export default async function CategoriesPage(): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const categories = await listCategories(principal);
  const nodes = categories.map((category) => ({ id: category.id, parentId: category.parentId }));

  const parentOptions = [
    { value: '', label: '— top level —' },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];

  return (
    <div className="space-y-6">
      <PageHeading
        title="Categories"
        subtitle="One shared tree. A parent change that would close a loop is refused."
      />

      <Card title="Add a category" subtitle="Create a new top-level category or subcategory.">
        <ActionForm
          action={createCategoryAction}
          submitLabel="Add category"
          className="flex flex-wrap items-end gap-3"
        >
          <Field label="Name" name="name" required width="w-52" />
          <Select label="Parent" name="parentId" options={parentOptions} width="w-60" />
        </ActionForm>
      </Card>

      <Card
        title={`${String(categories.length)} categor${categories.length === 1 ? 'y' : 'ies'}`}
        subtitle="Hierarchy of departments and sections."
      >
        {categories.length === 0 ? (
          <Empty title="No categories created">No categories have been added yet.</Empty>
        ) : (
          <Table head={['Name', 'Slug', 'Move / activate']}>
            {categories.map((category) => (
              <tr key={category.id} className="hover:bg-slate-50/60 transition">
                <td className="py-3 px-4 font-semibold text-slate-900">
                  <span
                    style={{ paddingLeft: `${String(depthOf(category.id, nodes) * 20)}px` }}
                    className="inline-block"
                  >
                    {category.name}
                    {category.isActive ? null : (
                      <span className="ml-2 inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500">
                        inactive
                      </span>
                    )}
                  </span>
                </td>
                <td className="py-3 px-4 font-mono text-xs text-slate-500">{category.slug}</td>
                <td className="py-3 px-4">
                  <ActionForm
                    action={updateCategoryAction}
                    submitLabel="Save"
                    className="flex flex-wrap items-center gap-3"
                  >
                    <Hidden name="categoryId" value={category.id} />
                    <Select
                      label=""
                      name="parentId"
                      options={parentOptions.filter((option) => option.value !== category.id)}
                      defaultValue={category.parentId ?? ''}
                      width="w-52"
                    />
                    <Check label="Active" name="isActive" defaultChecked={category.isActive} />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
