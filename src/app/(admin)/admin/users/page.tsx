import { requirePrincipal } from '@/auth';
import { listUsers } from '@/modules/identity';
import { listStores } from '@/modules/stores';
import { formatDateTime } from '@/modules/admin';
import {
  createUserAction,
  resetPasswordAction,
  setUserActiveAction,
  updateUserRoleAction,
} from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, RoleBadge, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Staff and user access administration (AD8).
 * Scoped by role and assigned stores; managers can only manage staff within their store.
 */
export default async function UsersPage(): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const [users, stores] = await Promise.all([listUsers(principal), listStores(principal)]);

  const isSuperAdmin = principal.kind === 'user' && principal.role === 'SUPER_ADMIN';
  const roleOptions = isSuperAdmin
    ? [
        { value: 'STORE_STAFF', label: 'Store staff' },
        { value: 'STORE_MANAGER', label: 'Store manager' },
        { value: 'SUPER_ADMIN', label: 'Super admin' },
      ]
    : [{ value: 'STORE_STAFF', label: 'Store staff' }];

  const storeOptions = stores.map((store) => ({
    value: store.id,
    label: `${store.code} · ${store.name}`,
  }));

  const storeMap = new Map(stores.map((s) => [s.id, `${s.code} · ${s.name}`]));

  return (
    <div className="space-y-6">
      <PageHeading title="Users" subtitle="Staff accounts. There is no public signup." />

      <Card title="Add a user" subtitle="Provision a new staff or manager account.">
        <ActionForm
          action={createUserAction}
          submitLabel="Create user"
          className="flex flex-wrap items-end gap-3"
        >
          <Field
            label="Email"
            name="email"
            type="email"
            required
            width="w-56"
            placeholder="colleague@munderfresh.local"
          />
          <Field label="Name" name="name" required width="w-48" placeholder="Staff Name" />
          <Field label="Password" name="password" type="password" required width="w-40" />
          <Select label="Role" name="role" options={roleOptions} width="w-44" />
          <Select label="Store" name="storeId" options={storeOptions} width="w-56" />
        </ActionForm>
      </Card>

      <Card
        title={`${String(users.length)} user(s)`}
        subtitle="Authorized personnel with access to the back office."
      >
        {users.length === 0 ? (
          <Empty title="No users visible">No users matching your administrative scope.</Empty>
        ) : (
          <Table head={['Email', 'Name', 'Role', 'Store', 'Last login', 'Actions']}>
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-slate-50/60 transition align-top">
                <td className="py-3 px-4 font-mono text-xs font-bold text-slate-800">
                  {user.email}
                </td>
                <td className="py-3 px-4 font-semibold text-slate-900">{user.name}</td>
                <td className="py-3 px-4">
                  <RoleBadge role={user.role} />
                </td>
                <td className="py-3 px-4 text-xs font-medium text-slate-600">
                  {user.storeId ? (storeMap.get(user.storeId) ?? user.storeId) : 'Global'}
                </td>
                <td className="py-3 px-4 text-xs text-slate-500 font-medium">
                  {formatDateTime(user.lastLoginAt)}
                </td>
                <td className="py-3 px-4">
                  <div className="flex flex-col gap-2">
                    <ActionForm
                      action={setUserActiveAction}
                      submitLabel={user.isActive ? 'Disable' : 'Enable'}
                      submitButtonClassName={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-3 py-1.5 text-xs font-bold transition ${
                        user.isActive
                          ? 'bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100'
                          : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                      }`}
                    >
                      <Hidden name="userId" value={user.id} />
                      <Check label="active" name="isActive" defaultChecked={!user.isActive} />
                    </ActionForm>
                    <ActionForm
                      action={updateUserRoleAction}
                      submitLabel="Set role"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Hidden name="userId" value={user.id} />
                      <Select
                        label=""
                        name="role"
                        options={roleOptions}
                        defaultValue={user.role}
                        width="w-36"
                      />
                      <Select
                        label=""
                        name="storeId"
                        options={storeOptions}
                        defaultValue={user.storeId ?? ''}
                        width="w-44"
                      />
                    </ActionForm>
                    <ActionForm
                      action={resetPasswordAction}
                      submitLabel="Reset password"
                      className="flex flex-wrap items-center gap-2"
                    >
                      <Hidden name="userId" value={user.id} />
                      <Field
                        label=""
                        name="password"
                        type="password"
                        required
                        width="w-36"
                        placeholder="New password"
                      />
                    </ActionForm>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
