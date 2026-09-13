'use client';

import React, { useActionState, useState } from 'react';
import Link from 'next/link';
import { requestProductAction } from '../actions';
import { STOREFRONT_COPY_MANIFEST } from '../copy-manifest';
import { Notice } from '../ui';

interface ProductRequestFormProps {
  hasStore: boolean;
  storeName?: string | undefined;
  defaultProductName?: string | undefined;
  defaultCustomerName?: string | undefined;
  defaultCustomerPhone?: string | undefined;
}

interface FormState {
  outcome?: string | undefined;
  count: number;
}

export function ProductRequestForm({
  hasStore,
  storeName,
  defaultProductName = '',
  defaultCustomerName = '',
  defaultCustomerPhone = '',
}: ProductRequestFormProps): React.ReactElement {
  const [actionState, formAction, pending] = useActionState(
    async (prev: FormState, formData: FormData): Promise<FormState> => {
      const outcome = await requestProductAction(undefined, formData);
      return { outcome, count: prev.count + 1 };
    },
    { outcome: undefined, count: 0 },
  );

  const [lastDismissedCount, setLastDismissedCount] = useState(0);
  const [resetCount, setResetCount] = useState(0);

  const { form: formCopy, success: successCopy } = STOREFRONT_COPY_MANIFEST.productRequest;

  const isSuccess = actionState.outcome === 'ok' && actionState.count > lastDismissedCount;

  // Clear success state on successful submission
  if (isSuccess) {
    return (
      <div className="rounded-3xl border border-emerald-200/80 bg-emerald-50/70 p-8 sm:p-10 text-center shadow-xs">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 text-2xl font-bold shadow-xs">
          ✓
        </div>
        <h2 className="mt-4 text-2xl sm:text-3xl font-black text-slate-900">{successCopy.title}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 leading-relaxed">
          {successCopy.description}
          {storeName ? ` for ${storeName}.` : '.'}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/shop"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-700 px-6 py-2.5 text-sm font-bold text-white shadow-xs hover:bg-emerald-800 transition"
          >
            {successCopy.actionText}
          </Link>
          <button
            type="button"
            onClick={() => {
              setLastDismissedCount(actionState.count);
              setResetCount((c) => c + 1);
            }}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-2xs hover:bg-slate-50 transition"
          >
            {successCopy.submitAnotherText}
          </button>
        </div>
      </div>
    );
  }

  const noticeMessage = actionState.outcome === 'ok' ? undefined : actionState.outcome;
  const initialProductName = resetCount === 0 ? defaultProductName : '';

  return (
    <div
      key={resetCount}
      className="rounded-3xl border border-slate-200 bg-white p-6 sm:p-10 shadow-xs"
    >
      {!hasStore ? (
        <div
          role="alert"
          className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3.5 text-sm text-amber-950 shadow-2xs"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-900">
              !
            </span>
            <span className="font-semibold">{formCopy.noStoreSelectedPrompt}</span>
          </div>
          <Link
            href="/store/select"
            className="shrink-0 font-bold text-emerald-800 hover:underline"
          >
            {formCopy.chooseAreaLinkText}
          </Link>
        </div>
      ) : null}

      <Notice message={noticeMessage} />

      <form action={formAction} className="space-y-6">
        {/* Product Name (Required, max 120 chars) */}
        <div>
          <label htmlFor="productName" className="block text-xs font-bold text-slate-700 mb-1.5">
            {formCopy.productNameLabel} <span className="text-rose-600">*</span>
          </label>
          <input
            id="productName"
            name="productName"
            type="text"
            required
            maxLength={120}
            defaultValue={initialProductName}
            placeholder={formCopy.productNamePlaceholder}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 transition"
          />
        </div>

        {/* Brand and Pack Size */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="brand" className="block text-xs font-bold text-slate-700 mb-1.5">
              {formCopy.brandLabel}
            </label>
            <input
              id="brand"
              name="brand"
              type="text"
              maxLength={80}
              placeholder={formCopy.brandPlaceholder}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 transition"
            />
          </div>

          <div>
            <label htmlFor="packSize" className="block text-xs font-bold text-slate-700 mb-1.5">
              {formCopy.packSizeLabel}
            </label>
            <input
              id="packSize"
              name="packSize"
              type="text"
              maxLength={60}
              placeholder={formCopy.packSizePlaceholder}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 transition"
            />
          </div>
        </div>

        {/* Note / Preference (max 500 chars) */}
        <div>
          <label htmlFor="note" className="block text-xs font-bold text-slate-700 mb-1.5">
            {formCopy.noteLabel}
          </label>
          <textarea
            id="note"
            name="note"
            rows={3}
            maxLength={500}
            placeholder={formCopy.notePlaceholder}
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 transition"
          />
        </div>

        {/* Contact Info (Optional) */}
        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4 sm:p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
            Contact Details (Optional)
          </h3>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="customerName"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                {formCopy.customerNameLabel}
              </label>
              <input
                id="customerName"
                name="customerName"
                type="text"
                maxLength={120}
                defaultValue={defaultCustomerName}
                placeholder={formCopy.customerNamePlaceholder}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 transition"
              />
            </div>

            <div>
              <label
                htmlFor="customerPhone"
                className="block text-xs font-medium text-slate-600 mb-1"
              >
                {formCopy.customerPhoneLabel}
              </label>
              <input
                id="customerPhone"
                name="customerPhone"
                type="tel"
                maxLength={15}
                defaultValue={defaultCustomerPhone}
                placeholder={formCopy.customerPhonePlaceholder}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 transition"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Link
            href="/shop"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-emerald-700 px-6 py-2 text-sm font-bold text-white shadow-xs hover:bg-emerald-800 disabled:opacity-50 transition active:scale-[0.99]"
          >
            {pending ? 'Submitting…' : formCopy.submitButton}
          </button>
        </div>
      </form>
    </div>
  );
}
