import { requirePrincipal } from '@/auth';
import { listAreas, listStores, listZones, resolveServiceability } from '@/modules/stores';
import { resolveStoreId } from '@/modules/admin';
import { createAreaAction, createZoneAction, updateAreaAction, updateZoneAction } from '../actions';
import { ActionForm, Check, Field, Hidden } from '../form';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Delivery zones and serviceability administration (AD7).
 * Manages serviceable pincodes and delivery boundaries per store.
 */
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
    <div className="space-y-6">
      <PageHeading
        title="Delivery zones & areas"
        subtitle="Pincode is a stored hint, never the routing key — two areas under different stores may share one (ADR-0004)."
      />

      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/zones" />

      {/* Test Serviceability Box */}
      <Card
        title="Test serviceability"
        subtitle="Simulate the customer address resolution engine against current zone definitions."
      >
        <form method="get" className="flex flex-wrap items-end gap-3">
          {storeId !== null ? <input type="hidden" name="store" value={storeId} /> : null}
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">Locality</span>
            <input
              name="q"
              defaultValue={probe}
              placeholder="e.g. Jubilee Hills"
              className="min-h-[44px] w-56 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
            />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            <span className="mb-1.5 block">Pincode</span>
            <input
              name="pincode"
              defaultValue={probePincode}
              placeholder="500033"
              className="min-h-[44px] w-36 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800 transition active:scale-[0.99]"
          >
            Resolve
          </button>
        </form>
        {probeResult === null ? null : (
          <div className="mt-4 rounded-2xl bg-slate-900 p-4 text-emerald-400 font-mono text-xs overflow-x-auto">
            <pre>{JSON.stringify(probeResult, null, 2)}</pre>
          </div>
        )}
      </Card>

      {storeId === null ? (
        <Empty title="No Store Assigned">You are not assigned to a store.</Empty>
      ) : (
        <>
          <Card title="Add a zone" subtitle="Create a geographic cluster for delivery management.">
            <ActionForm
              action={createZoneAction}
              submitLabel="Add zone"
              className="flex flex-wrap items-end gap-3"
            >
              <Hidden name="storeId" value={storeId} />
              <Field
                label="Zone name"
                name="name"
                required
                width="w-64"
                placeholder="Central Zone"
              />
            </ActionForm>
          </Card>

          {areasByZone.map(({ zone, areas }) => (
            <Card
              key={zone.id}
              title={`${zone.name}${zone.isActive ? '' : ' (inactive)'}`}
              badge={
                zone.isActive ? (
                  <span className="rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-xs font-bold text-emerald-900">
                    Active
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-100 border border-slate-200 px-2.5 py-0.5 text-xs font-bold text-slate-500">
                    Inactive
                  </span>
                )
              }
            >
              <ActionForm
                action={updateZoneAction}
                submitLabel="Save zone"
                className="flex items-center gap-3 mb-4"
              >
                <Hidden name="zoneId" value={zone.id} />
                <Check label="Active" name="isActive" defaultChecked={zone.isActive} />
              </ActionForm>

              <div className="mt-4">
                {areas.length === 0 ? (
                  <Empty title="No localities mapped">
                    No delivery areas configured in this zone yet.
                  </Empty>
                ) : (
                  <Table head={['Area / Locality', 'Pincode', 'Status']}>
                    {areas.map((area) => (
                      <tr key={area.id} className="hover:bg-slate-50/60 transition">
                        <td className="py-3 px-4 font-bold text-slate-900">{area.name}</td>
                        <td className="py-3 px-4 font-mono text-xs font-semibold text-slate-700">
                          {area.pincode ?? '—'}
                        </td>
                        <td className="py-3 px-4">
                          <ActionForm
                            action={updateAreaAction}
                            submitLabel="Save"
                            className="flex items-center gap-2"
                          >
                            <Hidden name="areaId" value={area.id} />
                            <Check label="Active" name="isActive" defaultChecked={area.isActive} />
                          </ActionForm>
                        </td>
                      </tr>
                    ))}
                  </Table>
                )}
              </div>

              <div className="mt-5 rounded-2xl bg-slate-50 border border-slate-200/80 p-4">
                <h4 className="text-xs font-bold text-slate-700 mb-2">Add area to this zone</h4>
                <ActionForm
                  action={createAreaAction}
                  submitLabel="Add area"
                  className="flex flex-wrap items-end gap-3"
                >
                  <Hidden name="zoneId" value={zone.id} />
                  <Field
                    label="Area name"
                    name="name"
                    required
                    placeholder="Banjara Hills Road 12"
                  />
                  <Field
                    label="Pincode (optional)"
                    name="pincode"
                    width="w-32"
                    placeholder="500034"
                  />
                  <Field
                    label="Other names (comma separated)"
                    name="matchHints"
                    width="w-64"
                    placeholder="MLA Colony, Road 12"
                  />
                </ActionForm>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
