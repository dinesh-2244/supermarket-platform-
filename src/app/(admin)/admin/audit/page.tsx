import { requirePrincipal } from '@/auth';
import { auditEntries, formatDateTime } from '@/modules/admin';
import { Card, Empty, PageHeading, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * A read-only view of the generic sensitive-mutation trail (§21). Rich
 * dashboards and reporting are Phase 6; this is the plain list.
 *
 * The scoping happens in `auditEntries`, not here — a manager sees only what
 * they and their own store's staff did. Filtering in a template is filtering
 * that can be forgotten.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const params = await searchParams;
  const entityType = typeof params.entityType === 'string' ? params.entityType.trim() : '';
  const actorId = typeof params.actor === 'string' ? params.actor.trim() : '';

  const entries = await auditEntries(principal, {
    ...(entityType === '' ? {} : { entityType }),
    ...(actorId === '' ? {} : { actorId }),
    limit: 100,
  });

  return (
    <>
      <PageHeading title="Audit log" subtitle="Every sensitive mutation, newest first." />

      <Card title="Filter">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Entity type</span>
            <input
              name="entityType"
              defaultValue={entityType}
              placeholder="User, StoreSettings, StoreProduct…"
              className="w-56 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Actor id</span>
            <input
              name="actor"
              defaultValue={actorId}
              className="w-72 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            Filter
          </button>
        </form>
      </Card>

      <Card title={`${String(entries.length)} entr${entries.length === 1 ? 'y' : 'ies'}`}>
        {entries.length === 0 ? (
          <Empty>Nothing recorded yet.</Empty>
        ) : (
          <Table head={['When', 'Actor', 'Action', 'Entity', 'Before → after']}>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-slate-100 align-top">
                <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                  {formatDateTime(entry.createdAt)}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {entry.actorType}
                  <br />
                  {entry.actorId ?? '—'}
                </td>
                <td className="py-2 pr-3">{entry.action}</td>
                <td className="py-2 pr-3">
                  {entry.entityType}
                  <br />
                  <span className="font-mono text-xs text-slate-500">{entry.entityId}</span>
                </td>
                <td className="py-2 pr-3">
                  <pre className="max-w-md overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                    {JSON.stringify(entry.beforeJson)} → {JSON.stringify(entry.afterJson)}
                  </pre>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
