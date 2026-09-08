/**
 * The shapes every storefront page uses.
 *
 * Mobile-first (arch §9): the layouts below are single-column by default and
 * only widen at `sm:`/`md:`, and anything that cannot shrink — a wide table, a
 * long row of chips — scrolls **inside its own box**, never taking the page
 * with it. A horizontal scrollbar on the body is the one layout bug that makes
 * a shop unusable on a cheap phone.
 */
export function PageHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): React.ReactElement {
  return (
    <div className="mb-4">
      <h1 className="text-lg font-semibold sm:text-xl">{title}</h1>
      {subtitle !== undefined ? <p className="mt-1 text-sm text-slate-600">{subtitle}</p> : null}
    </div>
  );
}

export function Card({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="mb-4 rounded border border-slate-200 bg-white p-4">
      {title !== undefined ? <h2 className="mb-3 font-medium">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

/**
 * A message from a server action. `!`-prefixed means it failed — the same
 * convention the back office uses, so one `run()` helper serves both.
 *
 * `role="status"` rather than `alert`: these are outcomes of something the
 * shopper just did, announced politely, not interruptions.
 */
export function Notice({ message }: { message: string | undefined }): React.ReactElement | null {
  if (message === undefined || message === '') return null;
  const failed = message.startsWith('!');
  return (
    <p
      role="status"
      className={`mb-3 w-full whitespace-pre-line rounded border px-3 py-2 text-sm ${
        failed
          ? 'border-red-200 bg-red-50 text-red-800'
          : 'border-emerald-200 bg-emerald-50 text-emerald-900'
      }`}
    >
      {failed ? message.slice(1) : message}
    </p>
  );
}

/** Money for display. Paise are the only representation that ever leaves the DB. */
export function rupees(paise: number): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}₹${String(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, '0')}`;
}
