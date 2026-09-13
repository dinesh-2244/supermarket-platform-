import type { Metadata } from 'next';
import Link from 'next/link';
import { STORE_COMMUNITIES } from '../communities';
import { STOREFRONT_COPY_MANIFEST, formatHubCardDescription } from '../copy-manifest';
import { WaveHorizonGraphic } from '../promo-banner';

export const metadata: Metadata = {
  title: STOREFRONT_COPY_MANIFEST.about.meta.title,
  description: STOREFRONT_COPY_MANIFEST.about.meta.description,
};

/**
 * About Us editorial page (Requirement 3a).
 *
 * Details Munder Fresh's dedicated Navy Quarters operations,
 * honest pricing, daily operating hours, and service commitments.
 */
export default function AboutPage(): React.ReactElement {
  return (
    <div className="mx-auto max-w-4xl space-y-10 py-2 sm:py-6">
      {/* Hero Header */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-6 py-12 sm:px-12 sm:py-16 text-white shadow-lg border border-slate-800">
        <WaveHorizonGraphic className="text-sky-400/10" />
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold backdrop-blur text-sky-200 border border-sky-400/20">
            {STOREFRONT_COPY_MANIFEST.about.hero.badge}
          </span>
          <h1 className="mt-4 text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            {STOREFRONT_COPY_MANIFEST.about.hero.title}
          </h1>
          <p className="mt-3 text-sm sm:text-base text-slate-300 leading-relaxed">
            {STOREFRONT_COPY_MANIFEST.about.hero.description}
          </p>
        </div>
      </section>

      {/* Dedication Callout Block */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 p-6 sm:p-8 text-white border border-slate-800 shadow-sm">
        <WaveHorizonGraphic className="text-sky-400/10" />
        <div className="relative z-10 max-w-2xl mx-auto text-center">
          <p className="text-base sm:text-lg font-medium italic text-slate-200 leading-relaxed">
            &ldquo;{STOREFRONT_COPY_MANIFEST.about.quoteCallout.quote}&rdquo;
          </p>
        </div>
      </section>

      {/* The Two-Community Hyperlocal Model */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
        <div className="max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {STOREFRONT_COPY_MANIFEST.about.hubSystem.badge}
          </span>
          <h2 className="mt-1 text-2xl sm:text-3xl font-black text-slate-900">
            {STOREFRONT_COPY_MANIFEST.about.hubSystem.title}
          </h2>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            {STOREFRONT_COPY_MANIFEST.about.hubSystem.description}
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {STORE_COMMUNITIES.map((community) => (
            <div
              key={community.id}
              className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2 py-0.5 text-[11px] font-bold text-white">
                    {community.storeCode}
                  </span>
                  <span className="text-xs font-semibold text-slate-700">Dedicated Store Hub</span>
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">{community.name}</h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  {formatHubCardDescription(community.hubName)}
                </p>
              </div>
              <div className="mt-5 pt-4 border-t border-slate-200">
                <Link
                  href="/store/select"
                  className="text-xs font-bold text-slate-900 hover:text-sky-900 flex items-center gap-1"
                >
                  Shop {community.shortName} Store →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Operational Principles Grid */}
      <section className="space-y-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
            {STOREFRONT_COPY_MANIFEST.about.commitments.badge}
          </span>
          <h2 className="mt-1 text-2xl font-black text-slate-900">
            {STOREFRONT_COPY_MANIFEST.about.commitments.title}
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col">
            <span className="text-2xl">⚡</span>
            <h3 className="mt-3 text-sm font-bold text-slate-900">
              {STOREFRONT_COPY_MANIFEST.about.commitments.cards.scheduledSlots.title}
            </h3>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              {STOREFRONT_COPY_MANIFEST.about.commitments.cards.scheduledSlots.description}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col">
            <span className="text-2xl">🥦</span>
            <h3 className="mt-3 text-sm font-bold text-slate-900">
              {STOREFRONT_COPY_MANIFEST.about.commitments.cards.oneHubOneCommunity.title}
            </h3>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              {STOREFRONT_COPY_MANIFEST.about.commitments.cards.oneHubOneCommunity.description}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col">
            <span className="text-2xl">🏷️</span>
            <h3 className="mt-3 text-sm font-bold text-slate-900">
              {STOREFRONT_COPY_MANIFEST.about.commitments.cards.liveInventoryPricing.title}
            </h3>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              {STOREFRONT_COPY_MANIFEST.about.commitments.cards.liveInventoryPricing.description}
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col">
            <span className="text-2xl">🛡️</span>
            <h3 className="mt-3 text-sm font-bold text-slate-900">
              {STOREFRONT_COPY_MANIFEST.about.commitments.cards.payAtDoorstep.title}
            </h3>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              {STOREFRONT_COPY_MANIFEST.about.commitments.cards.payAtDoorstep.description}
            </p>
          </div>
        </div>
      </section>

      {/* Service Boundary & Unserviceable Notice */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900">
          {STOREFRONT_COPY_MANIFEST.about.serviceBoundary.title}
        </h2>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          {STOREFRONT_COPY_MANIFEST.about.serviceBoundary.description}
        </p>
        <div className="mt-4 flex flex-wrap gap-4">
          <Link
            href="/unserviceable"
            className="inline-flex items-center rounded-xl bg-slate-100 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-200 transition min-h-[44px]"
          >
            Request Delivery to Your Society →
          </Link>
          <Link
            href="/shop"
            className="inline-flex items-center rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 transition min-h-[44px]"
          >
            Browse Product Catalogue →
          </Link>
        </div>
      </section>
    </div>
  );
}
