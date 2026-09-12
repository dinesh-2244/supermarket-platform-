import { requirePrincipal } from '@/auth';
import { auditEntries, formatDateTime } from '@/modules/admin';
import { Card, Empty, PageHeading, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Audit log of sensitive administrative mutations (AD8).
 * Scoped automatically by principal's authorization level.
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
    <div className="space-y-6">
      <PageHeading title="Audit log" subtitle="Every sensitive mutation, newest first." />

      <Card title="Filter" subtitle="Locate mutation events by entity type or staff actor ID.">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">Entity type</span>
            <input
              name="entityType"
              defaultValue={entityType}
              placeholder="User, StoreSettings, StoreProduct…"
              className="min-h-[44px] w-64 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none placeholder:text-slate-400"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">Actor id</span>
            <input
              name="actor"
              defaultValue={actorId}
              placeholder="user_..."
              className="min-h-[44px] w-72 rounded-xl border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none placeholder:text-slate-400"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800 transition active:scale-[0.99]"
          >
            Filter
          </button>
        </form>
      </Card>

      <Card title={`${String(entries.length)} entr${entries.length === 1 ? 'y' : 'ies'}`}>
        {entries.length === 0 ? (
          <Empty title="No audit entries">No mutation records match the current criteria.</Empty>
        ) : (
          <Table head={['When', 'Actor', 'Action', 'Entity', 'Before → after']}>
            {entries.map((entry) => (
              <tr key={entry.id} className="hover:bg-slate-50/60 transition align-top">
                <td className="py-3 px-4 whitespace-nowrap text-xs font-medium text-slate-500">
                  {formatDateTime(entry.createdAt)}
                </td>
                <td className="py-3 px-4 font-mono text-xs">
                  <div className="font-bold text-slate-800">{entry.actorType}</div>
                  <div className="text-slate-500">{entry.actorId ?? '—'}</div>
                </td>
                <td className="py-3 px-4">
                  <span className="inline-flex items-center rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 font-mono text-xs font-bold text-slate-800">
                    {entry.action}
                  </span>
                </td>
                <td className="py-3 px-4">
                  <div className="font-semibold text-slate-900">{entry.entityType}</div>
                  <div className="font-mono text-xs text-slate-500">{entry.entityId}</div>
                </td>
                <td className="py-3 px-4">
                  <pre className="max-w-md overflow-x-auto rounded-xl bg-slate-50 border border-slate-200 p-2.5 font-mono text-[11px] text-slate-800">
                    {JSON.stringify(entry.beforeJson)} &rarr; {JSON.stringify(entry.afterJson)}
                  </pre>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
