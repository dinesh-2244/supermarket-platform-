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
  className,
  inputClassName,
  required,
  autoComplete,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  placeholder?: string;
  maxLength?: number;
  width?: string;
  className?: string;
  inputClassName?: string;
  required?: boolean;
  autoComplete?: string;
}): React.ReactElement {
  return (
    <label className={className ?? 'text-xs text-slate-600'}>
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        maxLength={maxLength}
        required={required}
        autoComplete={autoComplete}
        className={`${width} rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 min-h-[44px] transition ${inputClassName ?? ''}`}
      />
    </label>
  );
}
