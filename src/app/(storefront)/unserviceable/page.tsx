import type { Metadata } from 'next';
import Link from 'next/link';
import { captureInterestAction } from '../actions';
import { ActionForm, Field } from '../form';
import { PageHeading } from '../ui';

export const metadata: Metadata = {
  title: 'We do not deliver here yet',
  description: 'Tell us where you are and we will let you know when we reach you.',
};

/**
 * The out-of-zone page (D1, arch §15).
 *
 * **No catalogue is shown here.** Prices and availability are per store, so
 * there is no honest way to display them to someone no store serves — a
 * "preview" would be a price nobody can charge them. What we can do is record
 * the demand, which is exactly what `ServiceabilityRequest` is for.
 */
const REASONS: Readonly<Record<string, string>> = {
  'no-input': 'We could not tell which area you meant.',
  'unknown-area': 'That area is not one we deliver to.',
  'out-of-zone': 'You are just outside our delivery zones.',
  'store-closed': 'The shop that serves your area has paused orders for now.',
};

export default async function UnserviceablePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const raw = params.reason;
  const reason = typeof raw === 'string' ? raw : '';
  // Only a known reason is ever rendered — the query string is a visitor's to
  // write, and echoing it back would put their text on our page.
  const explanation = REASONS[reason] ?? 'We do not deliver to your area yet.';

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2 sm:py-6">
      <div className="flex flex-col items-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200/80 text-amber-700 shadow-xs">
          <svg
            className="h-8 w-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.75}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </div>
        <PageHeading title="We are not in your area yet" subtitle={explanation} />
      </div>

      <div className="rounded-3xl border border-slate-200/90 bg-white p-6 sm:p-8 shadow-xs">
        <h2 className="text-base font-bold text-slate-900 sm:text-lg">Tell us where you are</h2>
        <p className="mt-1.5 mb-5 text-xs sm:text-sm text-slate-600 leading-relaxed">
          We open new areas based on where people ask for us. Leave your pincode or the name of your
          locality — nothing else, and no account needed.
        </p>
        <ActionForm
          action={captureInterestAction}
          submitLabel="Let us know"
          className="space-y-4"
          submitButtonClassName="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-emerald-800 transition disabled:opacity-50"
        >
          <Field label="Pincode" name="pincode" maxLength={6} placeholder="500001" />
          <Field label="Locality" name="locality" maxLength={120} placeholder="Banjara Hills" />
        </ActionForm>
      </div>

      <div className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-4 text-center text-sm text-slate-600">
        Already in one of our areas?{' '}
        <Link
          href="/store/select"
          className="inline-flex min-h-[44px] items-center font-bold text-emerald-800 underline hover:text-emerald-900"
        >
          Choose it here
        </Link>
        .
      </div>
    </div>
  );
}
