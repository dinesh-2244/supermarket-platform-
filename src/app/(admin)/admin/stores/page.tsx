import { requirePrincipal } from '@/auth';
import { getSettings, listStores } from '@/modules/stores';
import { formatPaise, resolveStoreId } from '@/modules/admin';
import { createStoreAction, updateSettingsAction, updateStoreAction } from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Stores & operational settings administration (AD7).
 * Configures delivery fee, minimum basket order, slot capacities, and POS mode.
 */
export default async function StoresPage({
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

  if (storeId === null) {
    return (
      <div className="space-y-6">
        <PageHeading title="Stores & settings" />
        <Empty title="No Store Assigned">You are not assigned to a store.</Empty>
      </div>
    );
  }

  const settings = await getSettings(principal, storeId);
  const store = stores.find((candidate) => candidate.id === storeId);
  const isSuperAdmin = principal.kind === 'user' && principal.role === 'SUPER_ADMIN';

  return (
    <div className="space-y-6">
      <PageHeading
        title="Stores & settings"
        subtitle="Per-store business settings. Money is stored in paise; these fields are paise too."
      />

      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/stores" />

      {isSuperAdmin ? (
        <>
          <Card title="Stores" subtitle="All registered retail store locations on the platform.">
            <Table head={['Code', 'Name', 'Active', 'Edit']}>
              {stores.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/60 transition">
                  <td className="py-3 px-4 font-mono text-xs font-bold text-slate-800">
                    {row.code}
                  </td>
                  <td className="py-3 px-4 font-bold text-slate-900">{row.name}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-bold ${
                        row.isActive
                          ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                          : 'bg-slate-100 text-slate-600 border-slate-300'
                      }`}
                    >
                      {row.isActive ? 'yes' : 'no'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <ActionForm
                      action={updateStoreAction}
                      submitLabel="Save"
                      className="flex items-center gap-3"
                    >
                      <Hidden name="storeId" value={row.id} />
                      <Field label="Name" name="name" defaultValue={row.name} width="w-52" />
                      <Check label="Active" name="isActive" defaultChecked={row.isActive} />
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card
            title="Add a store"
            subtitle="Provision a new community dark store or supermarket hub."
          >
            <ActionForm
              action={createStoreAction}
              submitLabel="Create store"
              className="flex flex-wrap items-end gap-3"
            >
              <Field label="Code" name="code" required width="w-28" placeholder="S3" />
              <Field
                label="Name"
                name="name"
                required
                width="w-52"
                placeholder="Gachibowli Fresh"
              />
              <Field
                label="Address line 1"
                name="line1"
                width="w-64"
                placeholder="Plot 42, Financial District"
              />
              <Field label="City" name="city" width="w-36" defaultValue="Hyderabad" />
              <Field label="Pincode" name="pincode" width="w-28" placeholder="500032" />
            </ActionForm>
          </Card>
        </>
      ) : null}

      <Card
        title={store === undefined ? 'Settings' : `${store.code} · ${store.name}`}
        subtitle="Operational parameters, thresholds, and delivery scheduling rules."
      >
        <ActionForm action={updateSettingsAction} submitLabel="Save settings" className="space-y-4">
          <Hidden name="storeId" value={storeId} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label={`Delivery fee (paise) — ${formatPaise(settings.deliveryFeePaise)}`}
              name="deliveryFeePaise"
              type="number"
              defaultValue={settings.deliveryFeePaise}
              width="w-full"
            />
            <Field
              label={`Minimum order (paise) — ${formatPaise(settings.minOrderPaise)}`}
              name="minOrderPaise"
              type="number"
              defaultValue={settings.minOrderPaise}
              width="w-full"
            />
            <Field
              label="Slot length (minutes)"
              name="slotLengthMinutes"
              type="number"
              defaultValue={settings.slotLengthMinutes}
              width="w-full"
            />
            <Field
              label="Slot capacity"
              name="slotCapacity"
              type="number"
              defaultValue={settings.slotCapacity}
              width="w-full"
            />
            <Field
              label="Price variance (bp)"
              name="priceVariancePercentBp"
              type="number"
              defaultValue={settings.priceVariancePercentBp}
              width="w-full"
            />
            <Field
              label="Variance cap (paise)"
              name="priceVarianceAbsCapPaise"
              type="number"
              defaultValue={settings.priceVarianceAbsCapPaise}
              width="w-full"
            />
            <Field
              label="Low-stock threshold"
              name="lowStockThreshold"
              type="number"
              defaultValue={settings.lowStockThreshold}
              width="w-full"
            />
            <Select
              label="Substitutions"
              name="substitutionPolicy"
              defaultValue={settings.substitutionPolicy}
              options={[
                { value: 'NONE', label: 'None' },
                { value: 'ASK_CUSTOMER', label: 'Ask customer' },
                { value: 'STAFF_DISCRETION', label: 'Staff discretion' },
              ]}
              width="w-full"
            />
            <div className="flex items-center pt-5">
              <Check
                label="Accepting orders"
                name="isAcceptingOrders"
                defaultChecked={settings.isAcceptingOrders}
              />
            </div>
          </div>
        </ActionForm>

        {/* POS Mode Notice (AD12 Guardrail) */}
        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-xs text-slate-700 leading-relaxed">
            POS mode:{' '}
            <strong className="text-slate-900 font-mono font-bold">{settings.posMode}</strong>.
            Changing this is a super-admin action per ADR-0007.
            <code>MANUAL</code> mode is a permanent first-class operational mode for in-store manual
            bill entry.
          </p>
        </div>
      </Card>
    </div>
  );
}
