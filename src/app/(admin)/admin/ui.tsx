import Link from 'next/link';

/**
 * The handful of shapes every back-office screen uses. Deliberately plain: this
 * phase is about the operations being correct and reachable, not about styling.
 */
export function PageHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}): React.ReactElement {
  return (
    <div className="mb-5">
      <h1 className="text-xl font-semibold">{title}</h1>
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
    <section className="mb-6 rounded border border-slate-200 bg-white p-4">
      {title !== undefined ? <h2 className="mb-3 font-medium">{title}</h2> : null}
      {children}
    </section>
  );
}

export function Table({
  head,
  children,
}: {
  head: readonly string[];
  children: React.ReactNode;
}): React.ReactElement {
  return (
    // Wide tables scroll inside their own box rather than the page.
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-500">
            {head.map((cell) => (
              <th key={cell} className="py-2 pr-3 font-medium">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="py-6 text-sm text-slate-500">{children}</p>;
}

/** Store picker. A scoped principal never sees more than their own store. */
export function StoreSwitcher({
  stores,
  storeId,
  basePath,
}: {
  stores: readonly { id: string; code: string; name: string }[];
  storeId: string | null;
  basePath: string;
}): React.ReactElement | null {
  if (stores.length <= 1) return null;
  return (
    <div className="mb-4 flex flex-wrap gap-2 text-sm">
      {stores.map((store) => (
        <Link
          key={store.id}
          href={`${basePath}?store=${store.id}`}
          className={`rounded border px-2 py-1 ${
            store.id === storeId ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300'
          }`}
        >
          {store.code} · {store.name}
        </Link>
      ))}
    </div>
  );
}

/** Server-action result banner. */
export function Notice({ message }: { message: string | undefined }): React.ReactElement | null {
  if (message === undefined || message === '') return null;
  const isError = message.startsWith('!');
  return (
    <p
      role="status"
      className={`mb-4 rounded border px-3 py-2 text-sm ${
        isError
          ? 'border-red-300 bg-red-50 text-red-800'
          : 'border-green-300 bg-green-50 text-green-800'
      }`}
    >
      {isError ? message.slice(1) : message}
    </p>
  );
}
