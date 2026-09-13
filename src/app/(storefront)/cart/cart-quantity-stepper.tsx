'use client';

import { useState, useTransition } from 'react';
import { setCartQuantityAction, removeFromCartAction } from '../cart-actions';

/**
 * Interactive +/- quantity stepper for cart line items (Requirement 1).
 *
 * Automatically triggers setCartQuantityAction or removeFromCartAction via useTransition
 * on click with no manual "Update" button or page reload.
 * Meets WCAG touch target size >= 44x44px and surfaces server rejections via aria-live.
 */
export function CartQuantityStepper({
  productId,
  productName,
  qty,
  maxQty = 99,
}: {
  productId: string;
  productName: string;
  qty: number;
  maxQty?: number;
}): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleResult = (result: string): void => {
    if (result.startsWith('!')) {
      setErrorMessage(result.slice(1));
    } else {
      setErrorMessage(null);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <div
          className={`inline-flex items-center rounded-xl border border-slate-300 bg-white shadow-xs min-h-[44px] ${
            isPending ? 'opacity-70' : ''
          }`}
        >
          <button
            type="button"
            disabled={isPending}
            aria-label={`Decrease quantity of ${productName}`}
            onClick={() => {
              setErrorMessage(null);
              startTransition(async () => {
                const fd = new FormData();
                fd.set('productId', productId);
                if (qty <= 1) {
                  const res = await removeFromCartAction(undefined, fd);
                  handleResult(res);
                } else {
                  fd.set('qty', String(qty - 1));
                  const res = await setCartQuantityAction(undefined, fd);
                  handleResult(res);
                }
              });
            }}
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-l-xl text-lg font-bold text-slate-700 hover:bg-slate-100 active:scale-95 transition disabled:opacity-40"
          >
            −
          </button>

          <span
            className="min-w-[2.5rem] px-2 text-center text-sm font-extrabold text-slate-900 tabular-nums"
            aria-label={`Current quantity ${qty}`}
          >
            {qty}
          </span>

          <button
            type="button"
            disabled={isPending || qty >= maxQty}
            aria-label={`Increase quantity of ${productName}`}
            onClick={() => {
              setErrorMessage(null);
              startTransition(async () => {
                const fd = new FormData();
                fd.set('productId', productId);
                fd.set('qty', String(qty + 1));
                const res = await setCartQuantityAction(undefined, fd);
                handleResult(res);
              });
            }}
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-r-xl text-lg font-bold text-slate-700 hover:bg-slate-100 active:scale-95 transition disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      {/* Surface server action feedback / errors (M6) */}
      {errorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1 text-xs font-semibold text-rose-700 leading-tight animate-in fade-in duration-150"
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
