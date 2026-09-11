import type { Metadata } from 'next';
import { listServiceableAreas, type StorefrontArea } from '@/modules/stores';
import { chooseAreaAction } from '../actions';
import { ActionForm } from '../form';
import { Card, Empty, PageHeading } from '../ui';
import { CommunitySelector } from '../community-selector';

export const metadata: Metadata = {
  title: 'Choose your delivery area | Munder Fresh',
  description: 'Pick the community or area you want groceries delivered to.',
};

/**
 * The locality picker / store selector (D1, D2).
 *
 * Provides a 2-card community selector for the primary communities,
 * while retaining the curated area list and optional pincode filter.
 */
export default async function LocalityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const raw = params.pincode;
  const pincode = (typeof raw === 'string' ? raw : '').replace(/\D/g, '').slice(0, 6);

  const areas = await listServiceableAreas();
  const filtered = pincode === '' ? areas : areas.filter((area) => area.pincode === pincode);
  const shown = filtered.length > 0 ? filtered : areas;
  const filterMissed = pincode !== '' && filtered.length === 0;

  return (
    <div className="space-y-8">
      <PageHeading
        title="Where should we deliver?"
        subtitle="Select your community or find your block below for fresh scheduled slot grocery delivery."
      />

      {/* Primary 2-Card Community Selector (D2) */}
      <CommunitySelector
        title="Primary Gated Communities"
        subtitle="Select your residential community for dedicated scheduled slot delivery."
        showAreaSublist={false}
      />

      <Card title="Or choose your specific block / sector">
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Filter by pincode (optional)</span>
            <input
              name="pincode"
              inputMode="numeric"
              maxLength={6}
              defaultValue={pincode}
              placeholder="560011"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm sm:w-44 focus:border-emerald-600 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Filter
          </button>
        </form>

        {filterMissed ? (
          <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            We do not deliver to {pincode} yet — here is everywhere we do.
          </p>
        ) : null}

        {shown.length === 0 ? (
          <Empty>No delivery areas are open right now.</Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((area) => (
              <li key={area.areaId}>
                <AreaChoice area={area} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-center text-sm text-slate-600">
        Not on the list?{' '}
        <a
          href="/unserviceable"
          className="font-semibold text-emerald-800 underline hover:text-emerald-900"
        >
          Tell us where you are
        </a>{' '}
        and we will let you know when we expand to your community.
      </p>
    </div>
  );
}

function AreaChoice({ area }: { area: StorefrontArea }): React.ReactElement {
  const label = (
    <span className="text-sm">
      <span className="font-medium text-slate-900">{area.areaName}</span>
      {area.pincode === null ? null : (
        <span className="ml-2 text-xs text-slate-500 font-mono">({area.pincode})</span>
      )}
    </span>
  );

  if (!area.isAcceptingOrders) {
    return (
      <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
        {label}
        <span className="text-xs font-medium text-amber-800">
          Paused — not taking orders right now
        </span>
      </div>
    );
  }

  return (
    <ActionForm
      action={chooseAreaAction}
      submitLabel="Deliver here"
      className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 transition hover:border-emerald-500 hover:bg-emerald-50/20"
    >
      <input type="hidden" name="areaId" value={area.areaId} />
      {label}
    </ActionForm>
  );
}
