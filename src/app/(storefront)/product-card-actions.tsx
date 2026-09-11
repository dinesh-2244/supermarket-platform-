'use client';

import { useState, useTransition } from 'react';
import { addToCartAction, setCartQuantityAction, removeFromCartAction } from './cart-actions';

/**
 * Interactive 1-click ADD and Quantity Stepper for Product Cards (D3).
 *
 * Provides instant feedback via React useTransition, calling server actions
 * without full-page reloads. Full ≥44px tap targets for mobile usability (M4).
 * Surfaces server rejections (out-of-stock, limits, store paused) via aria-live (M6).
 */
export function ProductCardActions({
  productId,
  productName,
  qtyInCart = 0,
  isOutOfStock = false,
}: {
  productId: string;
  productName: string;
  qtyInCart?: number;
  isOutOfStock?: boolean;
}): React.ReactElement {
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (isOutOfStock) {
    return (
      <button
        type="button"
        disabled
        className="w-full rounded-xl bg-slate-100 py-2.5 text-center text-xs font-semibold text-slate-400 cursor-not-allowed min-h-[44px]"
      >
        Out of stock
      </button>
    );
  }

  const handleResult = (result: string): void => {
    if (result.startsWith('!')) {
      setErrorMessage(result.slice(1));
    } else {
      setErrorMessage(null);
    }
  };

  return (
    <div className="w-full">
      {qtyInCart > 0 ? (
        <div
          className={`flex items-center justify-between rounded-xl border border-emerald-700 bg-emerald-700 text-white shadow-xs min-h-[44px] px-1 ${
            isPending ? 'opacity-75' : ''
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
                if (qtyInCart === 1) {
                  const res = await removeFromCartAction(undefined, fd);
                  handleResult(res);
                } else {
                  fd.set('qty', String(qtyInCart - 1));
                  const res = await setCartQuantityAction(undefined, fd);
                  handleResult(res);
                }
              });
            }}
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-lg font-bold text-white hover:bg-emerald-800 active:scale-95 transition"
          >
            −
          </button>

          <span className="text-sm font-extrabold px-2 text-white tabular-nums">{qtyInCart}</span>

          <button
            type="button"
            disabled={isPending}
            aria-label={`Increase quantity of ${productName}`}
            onClick={() => {
              setErrorMessage(null);
              startTransition(async () => {
                const fd = new FormData();
                fd.set('productId', productId);
                fd.set('qty', String(qtyInCart + 1));
                const res = await setCartQuantityAction(undefined, fd);
                handleResult(res);
              });
            }}
            className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-lg font-bold text-white hover:bg-emerald-800 active:scale-95 transition"
          >
            +
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={isPending}
          aria-label={`Add ${productName} to basket`}
          onClick={() => {
            setErrorMessage(null);
            startTransition(async () => {
              const fd = new FormData();
              fd.set('productId', productId);
              fd.set('qty', '1');
              const res = await addToCartAction(undefined, fd);
              handleResult(res);
            });
          }}
          className={`w-full rounded-xl border border-emerald-700 bg-emerald-50 py-2.5 px-3 text-center text-xs font-bold text-emerald-800 hover:bg-emerald-700 hover:text-white active:scale-[0.98] transition shadow-xs min-h-[44px] h-[44px] ${
            isPending ? 'opacity-75' : ''
          }`}
        >
          {isPending ? 'Adding…' : 'ADD +'}
        </button>
      )}

      {/* Surface server action feedback / errors (M6) */}
      {errorMessage ? (
        <p
          role="alert"
          aria-live="polite"
          className="mt-1.5 rounded-lg bg-rose-50 border border-rose-200 px-2 py-1 text-[11px] font-semibold text-rose-700 leading-tight animate-in fade-in duration-150"
        >
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
