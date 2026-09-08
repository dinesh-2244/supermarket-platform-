import type { Metadata } from 'next';
import Link from 'next/link';
import { captureInterestAction } from '../actions';
import { ActionForm, Field } from '../form';
import { Card, PageHeading } from '../ui';

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
    <>
      <PageHeading title="We are not in your area yet" subtitle={explanation} />

      <Card title="Tell us where you are">
        <p className="mb-3 text-sm text-slate-600">
          We open new areas based on where people ask for us. Leave your pincode or the name of your
          locality — nothing else, and no account needed.
        </p>
        <ActionForm action={captureInterestAction} submitLabel="Let us know">
          <Field label="Pincode" name="pincode" maxLength={6} placeholder="500001" />
          <Field label="Locality" name="locality" maxLength={120} placeholder="Banjara Hills" />
        </ActionForm>
      </Card>

      <p className="text-sm text-slate-600">
        Already in one of our areas?{' '}
        <Link href="/locality" className="text-emerald-800 underline">
          Choose it here
        </Link>
        .
      </p>
    </>
  );
}
