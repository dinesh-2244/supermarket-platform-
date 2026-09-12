import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { listAddresses, type AddressRecord } from '@/modules/customers';
import { listServiceableAreas, type StorefrontArea } from '@/modules/stores';
import { currentStorefrontPrincipal } from '@/storefront';
import {
  addAddressAction,
  makeDefaultAddressAction,
  removeAddressAction,
  updateAddressAction,
} from '../actions';
import { ActionForm, Field } from '../../form';
import { Card, Empty } from '../../ui';
import { AccountBackLink, AccountNavTabs } from '../account-ui';

export const metadata: Metadata = {
  title: 'Your addresses | Munder Fresh',
  description: 'Manage saved delivery addresses for your naval quarters or community residence.',
};

/**
 * Address Book (D7).
 *
 * Scoped securely to the session customer. DeliveryArea choices map directly
 * to serviceable community delivery zones.
 */
export default async function AddressBookPage(): Promise<React.ReactElement> {
  const { customer, principal } = await currentStorefrontPrincipal();
  if (customer === null) redirect('/account/sign-in');

  const [addresses, areas] = await Promise.all([listAddresses(principal), listServiceableAreas()]);

  const countLabel = `${String(addresses.length)} saved address${addresses.length === 1 ? '' : 'es'}`;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <AccountBackLink />

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-900">
          Your addresses
        </h1>
        <p className="mt-1 text-sm text-slate-600">One of them is where we deliver by default.</p>
      </div>

      <AccountNavTabs active="addresses" />

      {/* Saved Addresses Section */}
      <Card
        title={countLabel}
        className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs mb-6"
      >
        {addresses.length === 0 ? (
          <div className="py-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              📍
            </div>
            <Empty>No addresses saved yet.</Empty>
            <p className="mt-1 text-xs text-slate-500 max-w-sm mx-auto">
              Add your naval quarters, apartment, or community address below for fast 1-click
              checkout.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {addresses.map((address) => (
              <li key={address.id} className="py-4 first:pt-0 last:pb-0">
                <AddressRow address={address} areas={areas} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Add New Address Card */}
      <Card
        title="Add an address"
        className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-xs"
      >
        <ActionForm
          action={addAddressAction}
          submitLabel="Save address"
          submitButtonClassName="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition disabled:opacity-50"
          className="flex flex-col gap-4 sm:max-w-md"
        >
          <Field
            label="Label (Home, Work…)"
            name="label"
            width="w-full"
            placeholder="e.g. Quarters Home, Office"
          />
          <Field
            label="Address line"
            name="line1"
            width="w-full"
            required
            placeholder="House / Flat No., Quarter Block"
          />
          <Field
            label="Second line (optional)"
            name="line2"
            width="w-full"
            placeholder="Street, Wing, or Sector"
          />
          <Field
            label="Landmark (optional)"
            name="landmark"
            width="w-full"
            placeholder="Near Community Center, Gate 2"
          />
          <AreaSelect areas={areas} />
          <Field
            label="Pincode (optional)"
            name="pincode"
            maxLength={6}
            width="w-full"
            placeholder="530005"
          />
          <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 min-h-[44px] cursor-pointer">
            <input
              type="checkbox"
              name="isDefault"
              className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            />
            <span>Deliver here by default</span>
          </label>
        </ActionForm>
      </Card>
    </div>
  );
}

function AddressRow({
  address,
  areas,
}: {
  address: AddressRecord;
  areas: readonly StorefrontArea[];
}): React.ReactElement {
  const area = areas.find((row) => row.areaId === address.areaId);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 grow">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-900 text-sm">{address.label ?? 'Address'}</span>
            {address.isDefault ? (
              <span className="inline-flex items-center rounded-full bg-emerald-700 px-2.5 py-0.5 text-xs font-bold text-white">
                Default
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-700 leading-snug">
            {[address.line1, address.line2, address.landmark].filter(Boolean).join(', ')}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {[area?.areaName, address.pincode].filter(Boolean).join(' · ') ||
              'No delivery area set'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {address.isDefault ? null : (
            <ActionForm
              action={makeDefaultAddressAction}
              submitLabel="Make default"
              submitButtonClassName="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-emerald-600/30 bg-emerald-50 px-3.5 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 transition"
              className="flex items-end"
            >
              <input type="hidden" name="addressId" value={address.id} />
            </ActionForm>
          )}
          <ActionForm
            action={removeAddressAction}
            submitLabel="Remove"
            submitButtonClassName="min-h-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 transition"
            className="flex items-end"
          >
            <input type="hidden" name="addressId" value={address.id} />
          </ActionForm>
        </div>
      </div>

      <details className="w-full rounded-2xl border border-slate-200/80 bg-slate-50/50 p-3.5 sm:p-4">
        <summary className="cursor-pointer text-xs font-bold text-emerald-800 hover:text-emerald-900 py-1 min-h-[44px] inline-flex items-center">
          Edit address details
        </summary>
        <ActionForm
          action={updateAddressAction}
          submitLabel="Update address"
          submitButtonClassName="min-h-[44px] inline-flex items-center justify-center rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 active:scale-[0.99] transition disabled:opacity-50"
          className="mt-3 flex flex-col gap-4 sm:max-w-md"
        >
          <input type="hidden" name="addressId" value={address.id} />
          <Field label="Label" name="label" defaultValue={address.label ?? ''} width="w-full" />
          <Field
            label="Address line"
            name="line1"
            defaultValue={address.line1}
            width="w-full"
            required
          />
          <Field
            label="Second line"
            name="line2"
            defaultValue={address.line2 ?? ''}
            width="w-full"
          />
          <Field
            label="Landmark"
            name="landmark"
            defaultValue={address.landmark ?? ''}
            width="w-full"
          />
          <AreaSelect areas={areas} selected={address.areaId} />
          <Field
            label="Pincode"
            name="pincode"
            defaultValue={address.pincode ?? ''}
            maxLength={6}
            width="w-full"
          />
          <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 min-h-[44px] cursor-pointer">
            <input
              type="checkbox"
              name="isDefault"
              defaultChecked={address.isDefault}
              className="h-4 w-4 rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
            />
            <span>Deliver here by default</span>
          </label>
        </ActionForm>
      </details>
    </div>
  );
}

/** Curated serviceable delivery areas select dropdown */
function AreaSelect({
  areas,
  selected,
}: {
  areas: readonly StorefrontArea[];
  selected?: string | null;
}): React.ReactElement {
  return (
    <label className="text-xs font-medium text-slate-700 block">
      <span className="mb-1 block">Delivery area</span>
      <select
        name="areaId"
        defaultValue={selected ?? ''}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm min-h-[44px] text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 transition"
      >
        <option value="">Not set</option>
        {areas.map((area) => (
          <option key={area.areaId} value={area.areaId}>
            {area.areaName}
            {area.pincode === null ? '' : ` · ${area.pincode}`}
          </option>
        ))}
      </select>
    </label>
  );
}
