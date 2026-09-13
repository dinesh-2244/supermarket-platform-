import type { Metadata } from 'next';
import Link from 'next/link';
import { STORE_COMMUNITIES } from '../communities';

export const metadata: Metadata = {
  title: 'About Us | Munder Fresh Hyperlocal Grocery',
  description:
    'Learn about Munder Fresh: our dedicated two-community hyperlocal grocery model and scheduled slot delivery.',
};

/**
 * About Us editorial page (Requirement 3a).
 *
 * Details Munder Fresh's hyperlocal grocery model, the dedicated two-community operations,
 * scheduled slot deliveries, and honest pricing with zero fabricated claims.
 */
export default function AboutPage(): React.ReactElement {
  return (
    <div className="mx-auto max-w-4xl space-y-10 py-2 sm:py-6">
      {/* Hero Header */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-800 px-6 py-12 sm:px-12 sm:py-16 text-white shadow-md">
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
            Our Hyperlocal Model
          </span>
          <h1 className="mt-4 text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            Dedicated Grocery for Residential Communities
          </h1>
          <p className="mt-3 text-sm sm:text-base text-emerald-100 leading-relaxed">
            Munder Fresh was built to serve residential communities with daily groceries delivered
            in scheduled time windows, with stock and pricing scoped directly to each
            community&apos;s dedicated store hub.
          </p>
        </div>
        <div className="absolute -right-8 -bottom-8 opacity-15 pointer-events-none text-9xl">
          🌱
        </div>
      </section>

      {/* The Two-Community Hyperlocal Model */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
        <div className="max-w-2xl">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
            How Munder Fresh Operates
          </span>
          <h2 className="mt-1 text-2xl sm:text-3xl font-black text-slate-900">
            The Two-Community Hub System
          </h2>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            Munder Fresh pairs dedicated community store hubs directly with residential societies,
            organizing inventory and delivery scheduling around local service areas.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {STORE_COMMUNITIES.map((community) => (
            <div
              key={community.id}
              className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-5 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2 py-0.5 text-[11px] font-bold text-white">
                    {community.storeCode}
                  </span>
                  <span className="text-xs font-semibold text-emerald-800">
                    Dedicated Store Hub
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">{community.name}</h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  Dedicated local inventory managed by {community.hubName}. Items in the catalogue
                  are drawn from this community hub&apos;s store records, updating with local stock
                  levels.
                </p>
              </div>
              <div className="mt-5 pt-4 border-t border-emerald-200/60">
                <Link
                  href="/store/select"
                  className="text-xs font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1"
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
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
            Our Commitments
          </span>
          <h2 className="mt-1 text-2xl font-black text-slate-900">
            Real Operational Facts, No Fabrications
          </h2>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col">
            <span className="text-2xl">⚡</span>
            <h3 className="mt-3 text-sm font-bold text-slate-900">Scheduled Slots</h3>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              We deliver in scheduled one-hour time windows so you know when your order is expected
              to arrive.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col">
            <span className="text-2xl">🥦</span>
            <h3 className="mt-3 text-sm font-bold text-slate-900">One Hub, One Community</h3>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              Each community is served by a dedicated store hub, so the catalogue reflects that
              hub&apos;s own store-recorded availability and pricing.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col">
            <span className="text-2xl">🏷️</span>
            <h3 className="mt-3 text-sm font-bold text-slate-900">Live Inventory &amp; Price</h3>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              What you see in your community catalogue reflects your hub's own recorded availability
              and prices, not a shared or estimated figure. If prices change, you are notified
              upfront.
            </p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col">
            <span className="text-2xl">🛡️</span>
            <h3 className="mt-3 text-sm font-bold text-slate-900">Pay at Doorstep</h3>
            <p className="mt-1.5 text-xs text-slate-600 leading-relaxed">
              Pay via Cash on Delivery or UPI once your order is handed over — no prepayment
              required.
            </p>
          </div>
        </div>
      </section>

      {/* Service Boundary & Unserviceable Notice */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900">
          Living Outside Our Current Communities?
        </h2>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Because we operate dedicated store hubs paired with specific residential partners, we only
          accept orders from addresses within our serviceable zones.
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
            className="inline-flex items-center rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 transition min-h-[44px]"
          >
            Browse Product Catalogue →
          </Link>
        </div>
      </section>
    </div>
  );
}
