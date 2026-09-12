'use client';

import { useActionState } from 'react';
import { Notice } from './ui';

/**
 * A form bound to a server action, with the action's own message shown back.
 *
 * Client-side only for `useActionState` — there is no validation or business
 * rule here. Everything the form submits is re-checked on the server, so a
 * disabled button or a hidden field changes nothing about what is permitted.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  className,
  submitButtonClassName,
}: {
  action: (state: string | undefined, form: FormData) => Promise<string>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
  submitButtonClassName?: string;
}): React.ReactElement {
  const [message, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className={className ?? 'flex flex-wrap items-end gap-3'}>
      <Notice message={message} />
      {children}
      <button
        type="submit"
        disabled={pending}
        className={
          submitButtonClassName ??
          'inline-flex min-h-[44px] items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white shadow-xs hover:bg-slate-800 active:scale-[0.99] transition disabled:opacity-50'
        }
      >
        {pending ? 'Working…' : submitLabel}
      </button>
    </form>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
  placeholder,
  width = 'w-40',
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  required?: boolean;
  placeholder?: string;
  width?: string;
}): React.ReactElement {
  return (
    <label className="text-xs font-semibold text-slate-700">
      <span className="mb-1.5 block">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        className={`${width} min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none transition placeholder:text-slate-400`}
      />
    </label>
  );
}

export function Select({
  label,
  name,
  options,
  defaultValue,
  width = 'w-40',
}: {
  label: string;
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  width?: string;
}): React.ReactElement {
  return (
    <label className="text-xs font-semibold text-slate-700">
      <span className="mb-1.5 block">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className={`${width} min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/20 focus:outline-none transition`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Check({
  label,
  name,
  defaultChecked,
}: {
  label: string;
  name: string;
  defaultChecked?: boolean;
}): React.ReactElement {
  return (
    <label className="inline-flex min-h-[44px] items-center gap-2 text-xs sm:text-sm font-medium text-slate-700 cursor-pointer select-none">
      <input
        name={name}
        type="checkbox"
        defaultChecked={defaultChecked}
        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
      />
      <span>{label}</span>
    </label>
  );
}

export function Hidden({ name, value }: { name: string; value: string }): React.ReactElement {
  return <input type="hidden" name={name} value={value} />;
}
