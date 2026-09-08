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
import { Card, Empty, PageHeading } from '../../ui';

export const metadata: Metadata = { title: 'Your addresses' };

/**
 * The address book (D7).
 *
 * Each address may name a `DeliveryArea`, chosen from the same curated list the
 * locality picker uses — an address pointing somewhere nobody delivers would
 * fail at checkout, which is far too late to find out. The pincode beside it is
 * an *attribute*, never the routing key (ADR-0004).
 *
 * Nothing on this page carries a customer id. Every action derives the owner
 * from the session, and `customers` looks a row up by id **and** owner, so
 * another shopper's address id is simply "not found".
 */
export default async function AddressBookPage(): Promise<React.ReactElement> {
  const { customer, principal } = await currentStorefrontPrincipal();
  if (customer === null) redirect('/account/sign-in');

  const [addresses, areas] = await Promise.all([listAddresses(principal), listServiceableAreas()]);

  return (
    <>
      <PageHeading title="Your addresses" subtitle="One of them is where we deliver by default." />

      <Card title={`${String(addresses.length)} saved address(es)`}>
        {addresses.length === 0 ? (
          <Empty>No addresses saved yet.</Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-slate-100">
            {addresses.map((address) => (
              <li key={address.id} className="py-3 first:pt-0 last:pb-0">
                <AddressRow address={address} areas={areas} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Add an address">
        <ActionForm
          action={addAddressAction}
          submitLabel="Save address"
          className="flex flex-col gap-3 sm:max-w-md"
        >
          <Field label="Label (Home, Work…)" name="label" />
          <Field label="Address line" name="line1" />
          <Field label="Second line (optional)" name="line2" />
          <Field label="Landmark (optional)" name="landmark" />
          <AreaSelect areas={areas} />
          <Field label="Pincode (optional)" name="pincode" maxLength={6} />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="isDefault" />
            Deliver here by default
          </label>
        </ActionForm>
      </Card>
    </>
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
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 grow text-sm">
        <p className="font-medium">
          {address.label ?? 'Address'}
          {address.isDefault ? (
            <span className="ml-2 rounded-full bg-emerald-700 px-2 py-0.5 text-xs text-white">
              Default
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-slate-600">
          {[address.line1, address.line2, address.landmark].filter(Boolean).join(', ')}
        </p>
        <p className="mt-0.5 text-xs text-slate-500">
          {[area?.areaName, address.pincode].filter(Boolean).join(' · ') || 'No delivery area set'}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {address.isDefault ? null : (
          <ActionForm
            action={makeDefaultAddressAction}
            submitLabel="Make default"
            className="flex items-end"
          >
            <input type="hidden" name="addressId" value={address.id} />
          </ActionForm>
        )}
        <ActionForm action={removeAddressAction} submitLabel="Remove" className="flex items-end">
          <input type="hidden" name="addressId" value={address.id} />
        </ActionForm>
      </div>

      <details className="w-full">
        <summary className="cursor-pointer text-xs text-emerald-800">Edit</summary>
        <ActionForm
          action={updateAddressAction}
          submitLabel="Update address"
          className="mt-2 flex flex-col gap-3 sm:max-w-md"
        >
          <input type="hidden" name="addressId" value={address.id} />
          <Field label="Label" name="label" defaultValue={address.label ?? ''} />
          <Field label="Address line" name="line1" defaultValue={address.line1} />
          <Field label="Second line" name="line2" defaultValue={address.line2 ?? ''} />
          <Field label="Landmark" name="landmark" defaultValue={address.landmark ?? ''} />
          <AreaSelect areas={areas} selected={address.areaId} />
          <Field
            label="Pincode"
            name="pincode"
            defaultValue={address.pincode ?? ''}
            maxLength={6}
          />
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" name="isDefault" defaultChecked={address.isDefault} />
            Deliver here by default
          </label>
        </ActionForm>
      </details>
    </div>
  );
}

/** The same curated list the locality picker offers — free text would not route. */
function AreaSelect({
  areas,
  selected,
}: {
  areas: readonly StorefrontArea[];
  selected?: string | null;
}): React.ReactElement {
  return (
    <label className="text-xs text-slate-600">
      <span className="mb-1 block">Delivery area</span>
      <select
        name="areaId"
        defaultValue={selected ?? ''}
        className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm sm:w-56"
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
