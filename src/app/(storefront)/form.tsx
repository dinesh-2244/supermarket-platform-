'use client';

import { useActionState } from 'react';
import { Notice } from './ui';

/**
 * A storefront form bound to a server action, showing that action's own message.
 *
 * Client-side only for `useActionState`. There is no rule, no price and no
 * availability decided here: everything this form submits is re-checked on the
 * server, so a disabled control or a hidden field changes what the shopper
 * *sees*, never what the server permits.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  className,
  pendingLabel,
  submitButtonClassName,
}: {
  action: (state: string | undefined, form: FormData) => Promise<string>;
  children?: React.ReactNode;
  submitLabel: string;
  className?: string;
  pendingLabel?: string;
  submitButtonClassName?: string;
}): React.ReactElement {
  const [message, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className={className ?? 'flex flex-wrap items-end gap-2'}>
      <Notice message={message} />
      {children}
      <button
        type="submit"
        disabled={pending}
        className={
          submitButtonClassName ??
          'rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-50'
        }
      >
        {pending ? (pendingLabel ?? 'Working…') : submitLabel}
      </button>
    </form>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  placeholder,
  maxLength,
  width = 'w-full sm:w-56',
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
  width?: string;
}): React.ReactElement {
  return (
    <label className="text-xs text-slate-600">
      <span className="mb-1 block">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`${width} rounded border border-slate-300 px-2 py-1.5 text-sm text-slate-900`}
      />
    </label>
  );
}
