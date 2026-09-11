import Link from 'next/link';
import { chooseAreaAction } from './actions';
import { ActionForm } from './form';
import { getCommunityCards, type CommunityCardData } from './communities';

export async function CommunitySelector({
  title = 'Select Your Store Community',
  subtitle = 'Fresh groceries, dairy, produce & daily essentials delivered to your doorstep in convenient scheduled slots.',
  showAreaSublist = true,
}: {
  title?: string;
  subtitle?: string;
  showAreaSublist?: boolean;
}): Promise<React.ReactElement> {
  const communities = await getCommunityCards();

  return (
    <section className="w-full">
      <div className="mb-6 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-600/20">
          Hyperlocal Community Delivery
        </span>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {title}
        </h1>
        <p className="mt-1 text-sm text-slate-600 max-w-xl mx-auto">{subtitle}</p>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        {communities.map((community) => (
          <CommunityCard
            key={community.id}
            community={community}
            showAreaSublist={showAreaSublist}
          />
        ))}
      </div>

      <div className="mt-8 text-center text-xs text-slate-500">
        Living outside these communities?{' '}
        <Link
          href="/unserviceable"
          className="font-medium text-emerald-700 underline hover:text-emerald-800"
        >
          Request delivery to your locality
        </Link>
      </div>
    </section>
  );
}

function CommunityCard({
  community,
  showAreaSublist,
}: {
  community: CommunityCardData;
  showAreaSublist?: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col rounded-2xl border-2 border-slate-200/80 bg-white p-5 shadow-sm transition hover:border-emerald-600 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 font-bold text-lg">
            🏪
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">{community.name}</h2>
            <p className="text-xs text-slate-500 font-medium">{community.subtitle}</p>
          </div>
        </div>

        {community.isAcceptingOrders ? (
          <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/20">
            Open
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-600/20">
            Paused
          </span>
        )}
      </div>

      <div className="my-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-600 space-y-1.5 border border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-emerald-600 font-bold">⚡</span>
          <span>{community.deliveryNote}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-500">
          <span>📍</span>
          <span>Primary Hub: {community.areas[0]?.areaName ?? 'Local Store Hub'}</span>
        </div>
      </div>

      <div className="mt-auto pt-2">
        <ActionForm
          action={chooseAreaAction}
          submitLabel={`Shop ${community.shortName} →`}
          pendingLabel={`Connecting to ${community.shortName}…`}
          submitButtonClassName="inline-flex items-center justify-center w-full rounded-xl bg-emerald-700 py-3 text-center text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:opacity-50 min-h-[44px] h-[48px]"
          className="w-full"
        >
          <input type="hidden" name="areaId" value={community.primaryAreaId} />
        </ActionForm>
      </div>

      {showAreaSublist && community.areas.length > 0 ? (
        <details className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <summary className="cursor-pointer font-medium hover:text-slate-800">
            View all {community.areas.length} serviceable sectors / blocks
          </summary>
          <ul className="mt-2 space-y-1.5 pl-1 max-h-40 overflow-y-auto">
            {community.areas.map((area) => (
              <li
                key={area.areaId}
                className="flex items-center justify-between py-1 border-b border-slate-50"
              >
                <ActionForm
                  action={chooseAreaAction}
                  submitLabel="Deliver here"
                  className="flex w-full items-center justify-between"
                >
                  <input type="hidden" name="areaId" value={area.areaId} />
                  <span className="font-medium text-slate-700">{area.areaName}</span>
                  <button
                    type="submit"
                    className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 hover:underline"
                  >
                    Deliver here
                  </button>
                </ActionForm>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
