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
import { Card, Empty, PageHeading, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * `listUsers` is already filtered by `allowedStoreIds` in the identity module, so
 * a store manager sees only their own store's staff — this page does no
 * filtering of its own, because filtering in a template is filtering that can be
 * forgotten.
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
    : // A manager may only ever mint staff — creating a peer would be unbounded.
      [{ value: 'STORE_STAFF', label: 'Store staff' }];

  const storeOptions = stores.map((store) => ({
    value: store.id,
    label: `${store.code} · ${store.name}`,
  }));

  return (
    <>
      <PageHeading title="Users" subtitle="Staff accounts. There is no public signup." />

      <Card title="Add a user">
        <ActionForm action={createUserAction} submitLabel="Create user">
          <Field label="Email" name="email" type="email" required />
          <Field label="Name" name="name" required />
          <Field label="Password" name="password" type="password" required />
          <Select label="Role" name="role" options={roleOptions} />
          <Select label="Store" name="storeId" options={storeOptions} width="w-52" />
        </ActionForm>
      </Card>

      <Card title={`${String(users.length)} user(s)`}>
        {users.length === 0 ? (
          <Empty>No users you can see.</Empty>
        ) : (
          <Table head={['Email', 'Name', 'Role', 'Store', 'Last login', 'Actions']}>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3">{user.email}</td>
                <td className="py-2 pr-3">{user.name}</td>
                <td className="py-2 pr-3">{user.role}</td>
                <td className="py-2 pr-3 font-mono text-xs">{user.storeId ?? '—'}</td>
                <td className="py-2 pr-3 text-slate-500">{formatDateTime(user.lastLoginAt)}</td>
                <td className="py-2 pr-3">
                  <div className="flex flex-col gap-2">
                    <ActionForm
                      action={setUserActiveAction}
                      submitLabel={user.isActive ? 'Disable' : 'Enable'}
                    >
                      <Hidden name="userId" value={user.id} />
                      <Check label="active" name="isActive" defaultChecked={!user.isActive} />
                    </ActionForm>
                    <ActionForm action={updateUserRoleAction} submitLabel="Set role">
                      <Hidden name="userId" value={user.id} />
                      <Select label="" name="role" options={roleOptions} defaultValue={user.role} />
                      <Select
                        label=""
                        name="storeId"
                        options={storeOptions}
                        defaultValue={user.storeId ?? ''}
                        width="w-44"
                      />
                    </ActionForm>
                    <ActionForm action={resetPasswordAction} submitLabel="Reset password">
                      <Hidden name="userId" value={user.id} />
                      <Field label="" name="password" type="password" required />
                    </ActionForm>
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
