import { requirePrincipal } from '@/auth';
import { getSettings, listStores } from '@/modules/stores';
import { formatPaise, resolveStoreId } from '@/modules/admin';
import { createStoreAction, updateSettingsAction, updateStoreAction } from '../actions';
import { ActionForm, Check, Field, Hidden, Select } from '../form';
import { Card, Empty, PageHeading, StoreSwitcher, Table } from '../ui';

export const dynamic = 'force-dynamic';

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
      <>
        <PageHeading title="Stores & settings" />
        <Empty>You are not assigned to a store.</Empty>
      </>
    );
  }

  const settings = await getSettings(principal, storeId);
  const store = stores.find((candidate) => candidate.id === storeId);
  const isSuperAdmin = principal.kind === 'user' && principal.role === 'SUPER_ADMIN';

  return (
    <>
      <PageHeading
        title="Stores & settings"
        subtitle="Per-store business settings. Money is stored in paise; these fields are paise too."
      />
      <StoreSwitcher stores={stores} storeId={storeId} basePath="/admin/stores" />

      {isSuperAdmin ? (
        <>
          <Card title="Stores">
            <Table head={['Code', 'Name', 'Active', 'Edit']}>
              {stores.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono text-xs">{row.code}</td>
                  <td className="py-2 pr-3">{row.name}</td>
                  <td className="py-2 pr-3">{row.isActive ? 'yes' : 'no'}</td>
                  <td className="py-2 pr-3">
                    <ActionForm action={updateStoreAction} submitLabel="Save">
                      <Hidden name="storeId" value={row.id} />
                      <Field label="Name" name="name" defaultValue={row.name} />
                      <Check label="Active" name="isActive" defaultChecked={row.isActive} />
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title="Add a store">
            <ActionForm action={createStoreAction} submitLabel="Create store">
              <Field label="Code" name="code" required width="w-28" placeholder="S3" />
              <Field label="Name" name="name" required width="w-52" />
              <Field label="Address line 1" name="line1" width="w-52" />
              <Field label="City" name="city" width="w-36" />
              <Field label="Pincode" name="pincode" width="w-28" />
            </ActionForm>
          </Card>
        </>
      ) : null}

      <Card title={store === undefined ? 'Settings' : `${store.code} · ${store.name}`}>
        <ActionForm action={updateSettingsAction} submitLabel="Save settings">
          <Hidden name="storeId" value={storeId} />
          <Field
            label={`Delivery fee (paise) — ${formatPaise(settings.deliveryFeePaise)}`}
            name="deliveryFeePaise"
            type="number"
            defaultValue={settings.deliveryFeePaise}
          />
          <Field
            label={`Minimum order (paise) — ${formatPaise(settings.minOrderPaise)}`}
            name="minOrderPaise"
            type="number"
            defaultValue={settings.minOrderPaise}
          />
          <Field
            label="Slot length (minutes)"
            name="slotLengthMinutes"
            type="number"
            defaultValue={settings.slotLengthMinutes}
          />
          <Field
            label="Slot capacity"
            name="slotCapacity"
            type="number"
            defaultValue={settings.slotCapacity}
          />
          <Field
            label="Price variance (bp)"
            name="priceVariancePercentBp"
            type="number"
            defaultValue={settings.priceVariancePercentBp}
          />
          <Field
            label="Variance cap (paise)"
            name="priceVarianceAbsCapPaise"
            type="number"
            defaultValue={settings.priceVarianceAbsCapPaise}
          />
          <Field
            label="Low-stock threshold"
            name="lowStockThreshold"
            type="number"
            defaultValue={settings.lowStockThreshold}
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
          />
          <Check
            label="Accepting orders"
            name="isAcceptingOrders"
            defaultChecked={settings.isAcceptingOrders}
          />
        </ActionForm>

        {/* posMode selects the POS implementation (ADR-0007) and is deliberately
            not editable here — it is a SUPER_ADMIN action with its own grant. */}
        <p className="mt-3 text-xs text-slate-500">
          POS mode: <strong>{settings.posMode}</strong>. Changing it is a super-admin action — it
          selects which POS implementation this store runs (ADR-0007).
        </p>
      </Card>
    </>
  );
}
