import { requirePrincipal } from '@/auth';
import { beginTotpEnrolment, hasTotpEnrolled } from '@/modules/identity';
import { disableTotpAction, enrolTotpAction } from '../actions';
import { ActionForm, Field, Hidden } from '../form';
import { Card, PageHeading } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Optional two-factor authentication for staff accounts.
 */
export default async function TwoFactorPage(): Promise<React.ReactElement> {
  const principal = await requirePrincipal();
  const enrolled = await hasTotpEnrolled(principal);

  const enrolment = enrolled ? null : await beginTotpEnrolment(principal);

  return (
    <div className="space-y-6">
      <PageHeading
        title="Two-factor authentication"
        subtitle="An authenticator code on top of your password. Optional — but strongly recommended if you are a super admin."
      />

      {enrolled ? (
        <Card
          title="You have a second factor enrolled"
          subtitle="Your account is protected by TOTP multi-factor authentication."
        >
          <p className="mb-4 max-w-prose text-xs sm:text-sm text-slate-600 leading-relaxed">
            Signing in asks for a six-digit code from your authenticator app. To turn it off you
            need both your password and a current code — if someone else had only your password,
            this is exactly the step that should stop them.
          </p>
          <ActionForm
            action={disableTotpAction}
            submitLabel="Turn off"
            className="flex flex-wrap items-end gap-3"
          >
            <Field label="Current password" name="password" type="password" required width="w-56" />
            <Field
              label="Code from your app"
              name="code"
              required
              placeholder="123456"
              width="w-36"
            />
          </ActionForm>
        </Card>
      ) : (
        <Card
          title="Set up an authenticator"
          subtitle="Pair an authenticator app (Google Authenticator, 1Password, etc.)"
        >
          <ol className="mb-6 max-w-prose list-decimal space-y-3 pl-5 text-xs sm:text-sm text-slate-600 leading-relaxed">
            <li>
              Add a new account in your authenticator app by typing the key below or using the
              configuration URI:
              <code className="mt-1 block overflow-x-auto rounded-xl bg-slate-100 p-3 font-mono text-xs break-all text-slate-800 border border-slate-200">
                {enrolment?.uri}
              </code>
            </li>
            <li>
              Setup key:{' '}
              <code
                data-testid="totp-secret"
                className="rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1 font-mono text-xs font-bold tracking-widest text-emerald-950"
              >
                {enrolment?.secret}
              </code>
            </li>
            <li>
              Enter the code it shows, plus your password, to switch it on. Do it in this visit —
              reloading this page issues a fresh key and the app would then be holding the old one.
            </li>
          </ol>
          <ActionForm
            action={enrolTotpAction}
            submitLabel="Turn on"
            className="flex flex-wrap items-end gap-3"
          >
            <Hidden name="secret" value={enrolment?.secret ?? ''} />
            <Field label="Current password" name="password" type="password" required width="w-56" />
            <Field
              label="Code from your app"
              name="code"
              required
              placeholder="123456"
              width="w-36"
            />
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
