import { redirect } from 'next/navigation';
import { currentPrincipal } from '@/auth';
import { signInAction } from '@/app/(admin)/admin/actions';
import { ActionForm, Field, Hidden } from '@/app/(admin)/admin/form';

/**
 * Staff sign-in.
 *
 * Deliberately in its own route group, **outside** the `(admin)` layout: that
 * layout redirects anyone without a principal to this page, so rendering this
 * page inside it would redirect to itself forever. Route groups do not affect
 * the URL, so this is still `/admin/sign-in`.
 *
 * There is **no public signup** — a `SUPER_ADMIN` creates every account
 * (arch §5), so this page offers no way to make one.
 */
export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  if ((await currentPrincipal()) !== null) redirect('/admin');

  const params = await searchParams;
  const next = typeof params.next === 'string' ? params.next : '';

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-4">
      <h1 className="mb-1 text-xl font-semibold">Back office</h1>
      <p className="mb-6 text-sm text-slate-600">Sign in with your staff account.</p>

      <ActionForm action={signInAction} submitLabel="Sign in" className="flex flex-col gap-3">
        <Hidden name="next" value={next} />
        <Field label="Email" name="email" type="email" required width="w-full" />
        <Field label="Password" name="password" type="password" required width="w-full" />
      </ActionForm>
    </div>
  );
}
