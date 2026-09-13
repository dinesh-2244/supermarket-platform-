import type { Metadata } from 'next';
import Link from 'next/link';
import { STORE_COMMUNITIES } from '../communities';
import { STOREFRONT_COPY_MANIFEST, formatContactHubDescription } from '../copy-manifest';

export const metadata: Metadata = {
  title: STOREFRONT_COPY_MANIFEST.contact.meta.title,
  description: STOREFRONT_COPY_MANIFEST.contact.meta.description,
};

/**
 * Contact Us page (Requirement 3).
 *
 * Structural-only display for Munder Fresh customer support:
 * - Accurately presents the two community store hubs (STORE_COMMUNITIES).
 * - Guides active order inquiries to the resident app and links to /about.
 * - Provides structural placeholders for phone, email, hours, and hub location
 *   ready for future operator contact details without needing layout redesigns.
 * - Zero fabricated phone numbers, emails, addresses, hours, or SLA promises.
 * - Strictly display-only (no backend form submissions).
 */
export default function ContactPage(): React.ReactElement {
  const { contact } = STOREFRONT_COPY_MANIFEST;

  return (
    <div className="mx-auto max-w-4xl space-y-10 py-2 sm:py-6">
      {/* Hero Header */}
      <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-800 via-emerald-700 to-teal-800 px-6 py-12 sm:px-12 sm:py-16 text-white shadow-md">
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
            {contact.hero.badge}
          </span>
          <h1 className="mt-4 text-3xl sm:text-5xl font-black tracking-tight leading-tight">
            {contact.hero.title}
          </h1>
          <p className="mt-3 text-sm sm:text-base text-emerald-100 leading-relaxed">
            {contact.hero.subtitle}
          </p>
        </div>
        <div className="absolute -right-8 -bottom-8 opacity-15 pointer-events-none text-9xl">
          📞
        </div>
      </section>

      {/* Primary In-App Support Guidance */}
      <section className="rounded-3xl border border-emerald-200/80 bg-emerald-50/60 p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-emerald-800">
              {contact.appNotice.badge}
            </span>
            <h2 className="mt-1 text-xl sm:text-2xl font-black text-slate-900">
              {contact.appNotice.title}
            </h2>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              {contact.appNotice.description}
            </p>
          </div>
          <Link
            href="/about"
            className="shrink-0 inline-flex items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-emerald-800 transition min-h-[44px]"
          >
            {contact.helpCard.aboutUsText} →
          </Link>
        </div>
      </section>

      {/* Community Store Hubs & Structured Contact Placeholders */}
      <section className="space-y-6">
        <div>
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
            {contact.communityHubs.badge}
          </span>
          <h2 className="mt-1 text-2xl sm:text-3xl font-black text-slate-900">
            {contact.communityHubs.title}
          </h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            {contact.communityHubs.description}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {STORE_COMMUNITIES.map((community) => (
            <div
              key={community.id}
              className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-6 shadow-xs hover:border-slate-300 transition"
            >
              <div>
                {/* Header: Store Code & Name */}
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center rounded-md bg-emerald-700 px-2 py-0.5 text-[11px] font-bold text-white">
                    {community.storeCode}
                  </span>
                  <span className="text-xs font-semibold text-emerald-800">
                    {community.hubName}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-bold text-slate-900">{community.name}</h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  {formatContactHubDescription(community.hubName)}
                </p>

                {/* Structured Contact Channel Slots (Ready for live values) */}
                <dl className="mt-5 space-y-3 border-t border-slate-100 pt-4 text-xs">
                  <div>
                    <dt className="font-semibold text-slate-700">{contact.channels.phoneLabel}</dt>
                    <dd className="mt-0.5 text-slate-500 italic">
                      {contact.channels.phonePlaceholder}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">{contact.channels.emailLabel}</dt>
                    <dd className="mt-0.5 text-slate-500 italic">
                      {contact.channels.emailPlaceholder}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">{contact.channels.hoursLabel}</dt>
                    <dd className="mt-0.5 text-slate-500 italic">
                      {contact.channels.hoursPlaceholder}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-slate-700">
                      {contact.channels.addressLabel}
                    </dt>
                    <dd className="mt-0.5 text-slate-500 italic">
                      {contact.channels.addressPlaceholder}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="mt-6 border-t border-slate-100 pt-4">
                <Link
                  href="/store/select"
                  className="inline-flex min-h-[44px] items-center text-xs font-bold text-emerald-800 hover:text-emerald-950 transition"
                >
                  Shop {community.shortName} Store →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Quick Help & Navigation Card */}
      <section className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h3 className="text-base font-bold text-slate-900">{contact.helpCard.title}</h3>
            <p className="mt-1 text-xs text-slate-500 max-w-lg leading-relaxed">
              {contact.helpCard.description}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/account"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 transition"
            >
              {contact.helpCard.viewOrdersText}
            </Link>
            <Link
              href="/about"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-800 transition"
            >
              {contact.helpCard.aboutUsText}
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
