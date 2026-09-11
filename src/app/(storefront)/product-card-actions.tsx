'use client';

import { useTransition } from 'react';
import { addToCartAction, setCartQuantityAction, removeFromCartAction } from './cart-actions';

/**
 * Interactive 1-click ADD and Quantity Stepper for Product Cards (D3).
 *
 * Provides instant feedback via React useTransition, calling the server actions
 * without full-page reloads. Minimum 44px tap targets for mobile usability.
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

  if (qtyInCart > 0) {
    return (
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
            startTransition(async () => {
              const fd = new FormData();
              fd.set('productId', productId);
              if (qtyInCart === 1) {
                await removeFromCartAction(undefined, fd);
              } else {
                fd.set('qty', String(qtyInCart - 1));
                await setCartQuantityAction(undefined, fd);
              }
            });
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-base font-bold text-white hover:bg-emerald-800 active:scale-95 transition"
        >
          −
        </button>

        <span className="text-xs font-extrabold px-2 text-white tabular-nums">{qtyInCart}</span>

        <button
          type="button"
          disabled={isPending}
          aria-label={`Increase quantity of ${productName}`}
          onClick={() => {
            startTransition(async () => {
              const fd = new FormData();
              fd.set('productId', productId);
              fd.set('qty', String(qtyInCart + 1));
              await setCartQuantityAction(undefined, fd);
            });
          }}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-base font-bold text-white hover:bg-emerald-800 active:scale-95 transition"
        >
          +
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const fd = new FormData();
          fd.set('productId', productId);
          fd.set('qty', '1');
          await addToCartAction(undefined, fd);
        });
      }}
      className={`w-full rounded-xl border border-emerald-700 bg-emerald-50 py-2.5 px-3 text-center text-xs font-bold text-emerald-800 hover:bg-emerald-700 hover:text-white active:scale-[0.98] transition shadow-xs min-h-[44px] ${
        isPending ? 'opacity-75' : ''
      }`}
    >
      {isPending ? 'Adding…' : 'ADD +'}
    </button>
  );
}
