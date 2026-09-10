import { requirePrincipal } from '@/auth';
import { beginTotpEnrolment, hasTotpEnrolled } from '@/modules/identity';
import { disableTotpAction, enrolTotpAction } from '../actions';
import { ActionForm, Field, Hidden } from '../form';
import { Card, PageHeading } from '../ui';

/**
 * Optional two-factor authentication for the signed-in staff account.
 *
 * Optional is the whole design: nothing here is required of anybody, and no
 * role is forced through it (arch phase 2). What is *not* optional is what
 * happens once you have enrolled — the sign-in form then wants the code, every
 * time. A stored secret that sign-in never asked about would be a badge, not a
 * second factor.
 *
 * `SUPER_ADMIN` accounts are the ones worth protecting: they can create and
 * reset every other account, so a single stolen password there is the whole
 * back office. The copy below says so rather than enforcing it.
 */
export const dynamic = 'force-dynamic';

export default async function TwoFactorPage(): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const enrolled = await hasTotpEnrolled(principal);

  // Minted per render and stored by nobody. Reloading this page therefore hands
  // out a *different* secret, which is why the instructions say to scan and
  // confirm in one go — the one in the hidden field is the one that counts.
  const enrolment = enrolled ? null : await beginTotpEnrolment(principal);

  return (
    <>
      <PageHeading
        title="Two-factor authentication"
        subtitle="An authenticator code on top of your password. Optional — but strongly recommended if you are a super admin."
      />

      {enrolled ? (
        <Card title="You have a second factor enrolled">
          <p className="mb-3 max-w-prose text-sm text-slate-600">
            Signing in asks for a six-digit code from your authenticator app. To turn it off you
            need both your password and a current code — if someone else had only your password,
            this is exactly the step that should stop them.
          </p>
          <ActionForm action={disableTotpAction} submitLabel="Turn off">
            <Field label="Current password" name="password" type="password" required />
            <Field label="Code from your app" name="code" required placeholder="123456" />
          </ActionForm>
        </Card>
      ) : (
        <Card title="Set up an authenticator">
          <ol className="mb-4 max-w-prose list-decimal space-y-2 pl-5 text-sm text-slate-600">
            <li>
              Add a new account in your authenticator app, either by opening this link on the phone
              or by typing the key below into it:
              <code className="mt-1 block overflow-x-auto rounded bg-slate-100 px-2 py-1 font-mono text-xs break-all text-slate-800">
                {enrolment?.uri}
              </code>
            </li>
            <li>
              Setup key:{' '}
              <code
                data-testid="totp-secret"
                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs tracking-wider text-slate-800"
              >
                {enrolment?.secret}
              </code>
            </li>
            <li>
              Enter the code it shows, plus your password, to switch it on. Do it in this visit —
              reloading this page issues a fresh key and the app would then be holding the old one.
            </li>
          </ol>
          <ActionForm action={enrolTotpAction} submitLabel="Turn on">
            <Hidden name="secret" value={enrolment?.secret ?? ''} />
            <Field label="Current password" name="password" type="password" required />
            <Field label="Code from your app" name="code" required placeholder="123456" />
          </ActionForm>
        </Card>
      )}
    </>
  );
}
