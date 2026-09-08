import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentCustomer } from '@/storefront';
import { signInAction } from '../actions';
import { ActionForm, Field } from '../../form';
import { Card, PageHeading } from '../../ui';

export const metadata: Metadata = { title: 'Sign in' };

export default async function CustomerSignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  // Already signed in: there is nothing to do here.
  if ((await currentCustomer()) !== null) redirect('/account');
  const changed = (await searchParams).changed === '1';

  return (
    <>
      <PageHeading
        title="Sign in"
        subtitle="An account is optional — you can shop and check out without one."
      />

      {changed ? (
        <p className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Your password is changed, and every device has been signed out. Sign in again with the new
          one.
        </p>
      ) : null}

      <Card>
        <ActionForm action={signInAction} submitLabel="Sign in" className="flex flex-col gap-3">
          <Field label="Email" name="email" type="email" />
          <Field label="Password" name="password" type="password" />
        </ActionForm>
      </Card>

      <p className="text-sm text-slate-600">
        No account yet?{' '}
        <Link href="/account/sign-up" className="text-emerald-800 underline">
          Create one
        </Link>
        .
      </p>
      {/* An honest statement of a known gap rather than a link that goes
          nowhere: password reset needs an email vendor, which is not wired. */}
      <p className="mt-2 text-xs text-slate-500">
        Forgotten your password? We cannot reset it yet — that needs email, which is not set up.
        Please get in touch with the shop.
      </p>
    </>
  );
}
