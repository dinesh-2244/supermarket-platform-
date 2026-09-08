import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MIN_CUSTOMER_PASSWORD_LENGTH } from '@/modules/customers';
import { currentStorefrontPrincipal } from '@/storefront';
import { changePasswordAction, signOutAction, updateProfileAction } from './actions';
import { ActionForm, Field } from '../form';
import { Card, PageHeading } from '../ui';

export const metadata: Metadata = { title: 'Your account' };

/**
 * The account area (D6/D7).
 *
 * Guarded here rather than in a layout: the sign-in and sign-up pages live
 * under `/account/*` too, and a layout that redirected everyone without a
 * session would make its own sign-in page unreachable — the redirect loop the
 * back office already learned about once.
 *
 * This is a **second** check regardless. Every action re-derives the principal
 * from the session row itself, so a page guard is a courtesy to the shopper,
 * not the boundary.
 */
export default async function AccountPage(): Promise<React.ReactElement> {
  const { customer } = await currentStorefrontPrincipal();
  if (customer === null) redirect('/account/sign-in');

  return (
    <>
      <PageHeading
        title="Your account"
        {...(customer.email === null ? {} : { subtitle: customer.email })}
      />

      <Card title="Your details">
        <ActionForm
          action={updateProfileAction}
          submitLabel="Save"
          className="flex flex-col gap-3 sm:max-w-sm"
        >
          <Field label="Name" name="name" defaultValue={customer.name} />
          <Field label="Mobile number" name="phone" defaultValue={customer.phone} />
        </ActionForm>
        {/* Changing an email needs a way to prove the new one, which needs a
            vendor that is not wired. Said plainly rather than offered and
            silently ignored. */}
        <p className="mt-3 text-xs text-slate-500">
          Your email is {customer.email ?? 'not set'}. Changing it needs email confirmation, which
          is not set up yet.
        </p>
      </Card>

      <Card title="Change your password">
        <p className="mb-3 text-sm text-slate-600">
          Changing your password signs you out everywhere, including here.
        </p>
        <ActionForm
          action={changePasswordAction}
          submitLabel="Change password"
          className="flex flex-col gap-3 sm:max-w-sm"
        >
          <Field label="Current password" name="currentPassword" type="password" />
          <Field
            label={`New password (at least ${String(MIN_CUSTOMER_PASSWORD_LENGTH)} characters)`}
            name="newPassword"
            type="password"
          />
        </ActionForm>
      </Card>

      <Card>
        <form action={signOutAction}>
          <button type="submit" className="rounded border border-slate-300 px-3 py-1.5 text-sm">
            Sign out
          </button>
        </form>
      </Card>
    </>
  );
}
