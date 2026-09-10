import Link from 'next/link';
import { requirePrincipal } from '@/auth';
import { formatDateTime, overview, resolveStoreId } from '@/modules/admin';
import { hasTotpEnrolled } from '@/modules/identity';
import { changePasswordAction } from './actions';
import { ActionForm, Field } from './form';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from './ui';

export const dynamic = 'force-dynamic';

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const requested = typeof params.store === 'string' ? params.store : undefined;

  const twoFactor = await hasTotpEnrolled(principal);
  const data = await overview(principal, null);
  const storeId = resolveStoreId(principal, requested, data.stores);
  const view = storeId === data.storeId ? data : await overview(principal, storeId);

  return (
    <>
      <PageHeading title="Overview" subtitle="What the back office is looking after right now." />
      <StoreSwitcher stores={view.stores} storeId={view.storeId} basePath="/admin" />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        {[
          { label: 'Stores', value: view.stores.length },
          { label: 'Products (master)', value: view.productCount },
          { label: 'Categories', value: view.categoryCount },
          { label: 'Listed here', value: view.listedCount },
        ].map((stat) => (
          <div key={stat.label} className="rounded border border-slate-200 bg-white p-3">
            <div className="text-2xl font-semibold">{stat.value}</div>
            <div className="text-xs text-slate-500">{stat.label}</div>
          </div>
        ))}
      </div>

      <Card title={`Low stock (at or below ${String(view.lowStock.threshold)})`}>
        {view.lowStock.items.length === 0 ? (
          <Empty>Nothing is running low.</Empty>
        ) : (
          <Table head={['Product id', 'Website stock', 'Last counted']}>
            {view.lowStock.items.map((item) => (
              <tr key={item.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-mono text-xs">{item.productId}</td>
                <td className="py-2 pr-3 font-semibold">{item.websiteStock}</td>
                <td className="py-2 pr-3 text-slate-500">{formatDateTime(item.lastCountedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      <Card title="Two-factor authentication">
        <p className="mb-2 text-sm text-slate-600">
          {twoFactor
            ? 'On — signing in asks for a code from your authenticator app.'
            : 'Off — your password alone signs you in. Recommended for super admins.'}
        </p>
        <Link href="/admin/two-factor" className="text-sm text-slate-900 underline">
          {twoFactor ? 'Manage two-factor authentication' : 'Set up two-factor authentication'}
        </Link>
      </Card>

      <Card title="Change my password">
        <ActionForm action={changePasswordAction} submitLabel="Change password">
          <Field label="Current password" name="current" type="password" required />
          <Field label="New password" name="next" type="password" required />
        </ActionForm>
      </Card>
    </>
  );
}
