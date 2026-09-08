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
}: {
  action: (state: string | undefined, form: FormData) => Promise<string>;
  children: React.ReactNode;
  submitLabel: string;
  className?: string;
}): React.ReactElement {
  const [message, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className={className ?? 'flex flex-wrap items-end gap-2'}>
      <Notice message={message} />
      {children}
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
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
    <label className="text-xs text-slate-600">
      <span className="mb-1 block">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        required={required}
        placeholder={placeholder}
        className={`${width} rounded border border-slate-300 px-2 py-1 text-sm text-slate-900`}
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
    <label className="text-xs text-slate-600">
      <span className="mb-1 block">{label}</span>
      <select
        name={name}
        defaultValue={defaultValue}
        className={`${width} rounded border border-slate-300 px-2 py-1 text-sm text-slate-900`}
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
    <label className="flex items-center gap-1 pb-1 text-xs text-slate-600">
      <input name={name} type="checkbox" defaultChecked={defaultChecked} />
      {label}
    </label>
  );
}

export function Hidden({ name, value }: { name: string; value: string }): React.ReactElement {
  return <input type="hidden" name={name} value={value} />;
}
