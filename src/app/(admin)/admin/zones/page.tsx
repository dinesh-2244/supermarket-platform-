import { requirePrincipal } from '@/auth';
import { listAreas, listStores, listZones, resolveServiceability } from '@/modules/stores';
import { resolveStoreId } from '@/modules/admin';
import { createAreaAction, createZoneAction, updateAreaAction, updateZoneAction } from '../actions';
import { ActionForm, Check, Field, Hidden } from '../form';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

export default async function ZonesPage({
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

  const zones = storeId === null ? [] : await listZones(principal, storeId);
  const areasByZone = await Promise.all(
    zones.map(async (zone) => ({ zone, areas: await listAreas(principal, zone.id) })),
  );

  // The "test serviceability" box — the only caller of resolveServiceability in
  // Phase 2, since there is no storefront yet.
  const probe = typeof params.q === 'string' ? params.q : '';
  const probePincode = typeof params.pincode === 'string' ? params.pincode : '';
  const probeResult =
    probe === '' && probePincode === ''
      ? null
      : await resolveServiceability({
          ...(probe === '' ? {} : { locality: probe }),
          ...(probePincode === '' ? {} : { pincode: probePincode }),
        });

  return (
    <>
      <PageHeading
        title="Delivery zones & areas"
        subtitle="Pincode is a stored hint, never the routing key — two areas under different stores may share one (ADR-0004)."
      />
      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/zones" />

      <Card title="Test serviceability">
        <form method="get" className="flex flex-wrap items-end gap-2">
          {storeId !== null ? <input type="hidden" name="store" value={storeId} /> : null}
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Locality</span>
            <input
              name="q"
              defaultValue={probe}
              className="w-52 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Pincode</span>
            <input
              name="pincode"
              defaultValue={probePincode}
              className="w-32 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <button type="submit" className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">
            Resolve
          </button>
        </form>
        {probeResult === null ? null : (
          <pre className="mt-3 overflow-x-auto rounded bg-slate-50 p-3 text-xs">
            {JSON.stringify(probeResult, null, 2)}
          </pre>
        )}
      </Card>

      {storeId === null ? (
        <Empty>You are not assigned to a store.</Empty>
      ) : (
        <>
          <Card title="Add a zone">
            <ActionForm action={createZoneAction} submitLabel="Add zone">
              <Hidden name="storeId" value={storeId} />
              <Field label="Zone name" name="name" required width="w-52" />
            </ActionForm>
          </Card>

          {areasByZone.map(({ zone, areas }) => (
            <Card key={zone.id} title={`${zone.name}${zone.isActive ? '' : ' (inactive)'}`}>
              <ActionForm action={updateZoneAction} submitLabel="Save zone">
                <Hidden name="zoneId" value={zone.id} />
                <Check label="Active" name="isActive" defaultChecked={zone.isActive} />
              </ActionForm>

              <div className="mt-3">
                {areas.length === 0 ? (
                  <Empty>No areas in this zone yet.</Empty>
                ) : (
                  <Table head={['Area', 'Pincode', 'Active']}>
                    {areas.map((area) => (
                      <tr key={area.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3">{area.name}</td>
                        <td className="py-2 pr-3">{area.pincode ?? '—'}</td>
                        <td className="py-2 pr-3">
                          <ActionForm action={updateAreaAction} submitLabel="Save">
                            <Hidden name="areaId" value={area.id} />
                            <Check label="Active" name="isActive" defaultChecked={area.isActive} />
                          </ActionForm>
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3">
                <ActionForm action={createAreaAction} submitLabel="Add area">
                  <Hidden name="zoneId" value={zone.id} />
                  <Field label="Area name" name="name" required />
                  <Field label="Pincode (optional)" name="pincode" width="w-28" />
                  <Field label="Other names (comma separated)" name="matchHints" width="w-56" />
                </ActionForm>
              </div>
            </Card>
          ))}
        </>
      )}
    </>
  );
}
