import { requirePrincipal } from '@/auth';
import { depthOf, listCategories } from '@/modules/catalog';
import { createCategoryAction, updateCategoryAction } from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, Table } from '../ui';

export const dynamic = 'force-dynamic';

/** The catalogue master is global, so this screen is `SUPER_ADMIN` only. */
export default async function CategoriesPage(): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const categories = await listCategories(principal);
  const nodes = categories.map((category) => ({ id: category.id, parentId: category.parentId }));

  const parentOptions = [
    { value: '', label: '— top level —' },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];

  return (
    <>
      <PageHeading
        title="Categories"
        subtitle="One shared tree. A parent change that would close a loop is refused."
      />

      <Card title="Add a category">
        <ActionForm action={createCategoryAction} submitLabel="Add category">
          <Field label="Name" name="name" required />
          <Select label="Parent" name="parentId" options={parentOptions} width="w-52" />
        </ActionForm>
      </Card>

      <Card title={`${String(categories.length)} categor${categories.length === 1 ? 'y' : 'ies'}`}>
        {categories.length === 0 ? (
          <Empty>No categories yet.</Empty>
        ) : (
          <Table head={['Name', 'Slug', 'Move / activate']}>
            {categories.map((category) => (
              <tr key={category.id} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  <span style={{ paddingLeft: `${String(depthOf(category.id, nodes) * 16)}px` }}>
                    {category.name}
                    {category.isActive ? '' : ' (inactive)'}
                  </span>
                </td>
                <td className="py-2 pr-3 font-mono text-xs">{category.slug}</td>
                <td className="py-2 pr-3">
                  <ActionForm action={updateCategoryAction} submitLabel="Save">
                    <Hidden name="categoryId" value={category.id} />
                    <Select
                      label=""
                      name="parentId"
                      options={parentOptions.filter((option) => option.value !== category.id)}
                      defaultValue={category.parentId ?? ''}
                      width="w-44"
                    />
                    <Check label="Active" name="isActive" defaultChecked={category.isActive} />
                  </ActionForm>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
