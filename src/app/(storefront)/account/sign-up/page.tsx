import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { MIN_CUSTOMER_PASSWORD_LENGTH } from '@/modules/customers';
import { currentCustomer } from '@/storefront';
import { signUpAction } from '../actions';
import { ActionForm, Field } from '../../form';
import { Card, PageHeading } from '../../ui';

export const metadata: Metadata = { title: 'Create an account' };

/**
 * Sign up (D6).
 *
 * Creating an account does **not** sign you in — see `customers.signUp`. Any
 * sign-up that did would tell an attacker whether an address was already taken,
 * because being signed in and not being signed in are different outcomes
 * however carefully the message is worded.
 */
export default async function CustomerSignUpPage(): Promise<React.ReactElement> {
  if ((await currentCustomer()) !== null) redirect('/account');

  return (
    <>
      <PageHeading
        title="Create an account"
        subtitle="Optional. It saves your addresses and keeps your basket with you."
      />

      <Card>
        <ActionForm
          action={signUpAction}
          submitLabel="Create account"
          className="flex flex-col gap-3"
        >
          <Field label="Name" name="name" />
          <Field label="Email" name="email" type="email" />
          <Field label="Mobile number" name="phone" placeholder="9876543210" />
          <Field
            label={`Password (at least ${String(MIN_CUSTOMER_PASSWORD_LENGTH)} characters)`}
            name="password"
            type="password"
          />
        </ActionForm>
      </Card>

      <p className="text-sm text-slate-600">
        Already have one?{' '}
        <Link href="/account/sign-in" className="text-emerald-800 underline">
          Sign in
        </Link>
        .
      </p>
    </>
  );
}
