import type { Metadata } from 'next';
import { listServiceableAreas, type StorefrontArea } from '@/modules/stores';
import { chooseAreaAction } from '../actions';
import { ActionForm } from '../form';
import { Card, Empty, PageHeading } from '../ui';

export const metadata: Metadata = {
  title: 'Choose your delivery area',
  description: 'Pick the area you want groceries delivered to.',
};

/**
 * The locality picker — the first thing a visitor without a store context sees
 * (D1, arch §9/§15).
 *
 * It lists the **curated** delivery areas rather than asking for a free-text
 * address, because that is what `resolveServiceability` is built to answer and
 * because a shopper picking from a list cannot mistype themselves out of the
 * zone. The optional pincode box filters the list; it is a *hint*, never the
 * decision — the same posture the resolver itself takes.
 *
 * The store each area belongs to is deliberately not shown. Which of the two
 * shops serves a street is an operational fact, not a choice the shopper makes,
 * and offering it as one would invite them to pick the wrong one.
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
  // A pincode nobody serves must not look like "we have no areas at all".
  const shown = filtered.length > 0 ? filtered : areas;
  const filterMissed = pincode !== '' && filtered.length === 0;

  return (
    <>
      <PageHeading
        title="Where should we deliver?"
        subtitle="Pick your area and we will show you the shop that serves it, with its prices and stock."
      />

      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-slate-600">
            <span className="mb-1 block">Filter by pincode (optional)</span>
            <input
              name="pincode"
              inputMode="numeric"
              maxLength={6}
              defaultValue={pincode}
              placeholder="500001"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm sm:w-40"
            />
          </label>
          <button type="submit" className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            Filter
          </button>
        </form>

        {filterMissed ? (
          <p className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
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

      <p className="text-sm text-slate-600">
        Not on the list?{' '}
        <a href="/unserviceable" className="text-emerald-800 underline">
          Tell us where you are
        </a>{' '}
        and we will let you know when we reach you.
      </p>
    </>
  );
}

/**
 * A store that has paused orders resolves as `store-closed`, not as servable —
 * so its areas cannot become a context and are shown as unavailable rather than
 * as a button that would bounce the shopper to the out-of-zone page.
 */
function AreaChoice({ area }: { area: StorefrontArea }): React.ReactElement {
  const label = (
    <span className="text-sm">
      <span className="font-medium">{area.areaName}</span>
      {area.pincode === null ? null : <span className="ml-2 text-slate-500">{area.pincode}</span>}
    </span>
  );

  if (!area.isAcceptingOrders) {
    return (
      <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-3 py-2">
        {label}
        <span className="text-xs text-amber-800">Paused — not taking orders right now</span>
      </div>
    );
  }

  return (
    <ActionForm
      action={chooseAreaAction}
      submitLabel="Deliver here"
      className="flex w-full flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-3 py-2"
    >
      <input type="hidden" name="areaId" value={area.areaId} />
      {label}
    </ActionForm>
  );
}
