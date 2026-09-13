'use client';

import React, { useState } from 'react';
import type { ProductRequestStatus } from './status-definitions';
import { updateProductRequestStatusAction } from '../actions';
import { ActionForm, Hidden } from '../form';

export function ProductRequestTriageForm({
  requestId,
  currentStatus,
  allowedTransitions,
}: {
  requestId: string;
  currentStatus: ProductRequestStatus;
  allowedTransitions: readonly ProductRequestStatus[];
}): React.ReactElement {
  const [selectedStatus, setSelectedStatus] = useState<ProductRequestStatus | ''>(
    allowedTransitions[0] ?? '',
  );
  const [note, setNote] = useState('');

  if (allowedTransitions.length === 0) {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs font-semibold text-slate-500">
        This request is {currentStatus} (terminal state). No further transitions are available.
      </div>
    );
  }

  const isDeclined = selectedStatus === 'DECLINED';

  return (
    <ActionForm
      action={updateProductRequestStatusAction}
      submitLabel={selectedStatus ? `Update status to ${selectedStatus}` : 'Select target status'}
      className="space-y-4"
    >
      <Hidden name="requestId" value={requestId} />

      <div>
        <label className="block text-xs font-bold text-slate-700 mb-1.5">
          Select Target Status <span className="text-rose-600">*</span>
        </label>
        <div className="flex flex-wrap gap-2">
          {allowedTransitions.map((status) => {
            const isChecked = selectedStatus === status;
            return (
              <label
                key={status}
                className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold cursor-pointer transition ${
                  isChecked
                    ? 'border-emerald-700 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-600/20'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="toStatus"
                  value={status}
                  checked={isChecked}
                  onChange={() => setSelectedStatus(status)}
                  className="sr-only"
                />
                <span
                  className={`h-2 w-2 rounded-full ${isChecked ? 'bg-emerald-600' : 'bg-slate-300'}`}
                />
                {status}
              </label>
            );
          })}
        </div>
      </div>

      <div>
        <label htmlFor="triage-note" className="block text-xs font-bold text-slate-700 mb-1.5">
          Triage Note / Reason{' '}
          {isDeclined ? (
            <span className="text-rose-600 font-semibold">* (Required when declining)</span>
          ) : (
            <span className="text-slate-400 font-normal">(Optional)</span>
          )}
        </label>
        <textarea
          id="triage-note"
          name="note"
          rows={2}
          required={isDeclined}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            isDeclined
              ? 'Provide the reason for declining this request (e.g. supplier discontinued, out of scope)...'
              : 'Add an operational update or triage note...'
          }
          className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-2xs placeholder:text-slate-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/20 transition"
        />
      </div>
    </ActionForm>
  );
}
