import React from 'react';
import { resolveCategoryGroup, type CategoryGroup } from './category-group';

export type { CategoryGroup };
export { resolveCategoryGroup };

export interface CategoryPlaceholderProps {
  categorySlug?: string | null | undefined;
  productSlug?: string | null | undefined;
  name?: string | null | undefined;
  size?: 'sm' | 'md' | 'lg' | undefined;
  className?: string | undefined;
}

interface PlaceholderConfig {
  readonly label: string;
  readonly bgClass: string;
  readonly iconClass: string;
  readonly badgeClass: string;
  readonly renderIcon: (className: string) => React.ReactElement;
}

const PLACEHOLDER_CONFIGS: Record<CategoryGroup, PlaceholderConfig> = {
  vegetables: {
    label: 'Produce',
    bgClass: 'bg-emerald-50/70',
    iconClass: 'text-emerald-600',
    badgeClass: 'bg-emerald-100/80 text-emerald-800',
    renderIcon: (cls) => (
      <svg
        className={cls}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 21a9 9 0 009-9c0-4.97-4.03-9-9-9-4.97 0-9 4.03-9 9a9 9 0 009 9z"
        />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c3 0 5 2 5 4.5S15 17 12 17" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 12c-3 0-5 2-5 4.5" />
      </svg>
    ),
  },
  dairy: {
    label: 'Dairy & Bakery',
    bgClass: 'bg-sky-50/70',
    iconClass: 'text-sky-600',
    badgeClass: 'bg-sky-100/80 text-sky-800',
    renderIcon: (cls) => (
      <svg
        className={cls}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 3h6m-5 3h4m-5 4h6m-7 4h8a2 2 0 002-2V8a2 2 0 00-2-2H8a2 2 0 00-2 2v6a2 2 0 002 2zm-1 0v4a2 2 0 002 2h6a2 2 0 002-2v-4"
        />
      </svg>
    ),
  },
  staples: {
    label: 'Staples & Grains',
    bgClass: 'bg-amber-50/70',
    iconClass: 'text-amber-600',
    badgeClass: 'bg-amber-100/80 text-amber-800',
    renderIcon: (cls) => (
      <svg
        className={cls}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 3v18m0-18C8.5 7.5 8 12 8 12s2 0 4-2m0-7c3.5 4.5 4 9 4 9s-2 0-4-2m0 7c-3.5 4.5-4 9-4 9s2 0 4-2m0-7c3.5 4.5 4 9 4 9s-2 0-4-2"
        />
      </svg>
    ),
  },
  beverages: {
    label: 'Snacks & Drinks',
    bgClass: 'bg-orange-50/70',
    iconClass: 'text-orange-600',
    badgeClass: 'bg-orange-100/80 text-orange-800',
    renderIcon: (cls) => (
      <svg
        className={cls}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M6 9h12v10a2 2 0 01-2 2H8a2 2 0 01-2-2V9zm0 0l2-5h8l2 5M10 4v5m4-5v5"
        />
      </svg>
    ),
  },
  household: {
    label: 'Household Care',
    bgClass: 'bg-indigo-50/70',
    iconClass: 'text-indigo-600',
    badgeClass: 'bg-indigo-100/80 text-indigo-800',
    renderIcon: (cls) => (
      <svg
        className={cls}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 4H9L8 4zm3 8a3 3 0 100-6 3 3 0 000 6z"
        />
      </svg>
    ),
  },
  general: {
    label: 'Grocery Item',
    bgClass: 'bg-slate-50',
    iconClass: 'text-slate-400',
    badgeClass: 'bg-slate-100 text-slate-700',
    renderIcon: (cls) => (
      <svg
        className={cls}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"
        />
      </svg>
    ),
  },
};

/**
 * Category-aware placeholder graphic for products without photography.
 *
 * Renders simple, clearly generic visual indicators (vegetables, dairy,
 * staples, snacks & beverages, household) that preserve visual hierarchy
 * without pretending to be real branded packaging.
 */
export function CategoryPlaceholder({
  categorySlug,
  productSlug,
  name,
  size = 'md',
  className = '',
}: CategoryPlaceholderProps): React.ReactElement {
  const group = resolveCategoryGroup({ categorySlug, productSlug, name });
  const config = PLACEHOLDER_CONFIGS[group];

  if (size === 'sm') {
    return (
      <div
        className={`flex h-full w-full items-center justify-center rounded-xl ${config.bgClass} ${config.iconClass} ${className}`}
        aria-label={`Category illustration: ${config.label}`}
        role="img"
      >
        {config.renderIcon('h-7 w-7 opacity-85')}
      </div>
    );
  }

  if (size === 'lg') {
    return (
      <div
        className={`flex min-h-[260px] sm:min-h-[340px] w-full flex-col items-center justify-center rounded-2xl p-6 text-center ${config.bgClass} ${className}`}
        aria-label={`Category illustration: ${config.label}`}
        role="img"
      >
        <div className="rounded-2xl bg-white/80 p-5 shadow-xs mb-3 backdrop-blur-xs">
          {config.renderIcon(`h-16 w-16 sm:h-20 sm:w-20 ${config.iconClass}`)}
        </div>
        <span
          className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-bold ${config.badgeClass}`}
        >
          {config.label}
        </span>
        <p className="mt-2 text-xs text-slate-500 max-w-xs leading-relaxed">
          Generic placeholder for {name ? `"${name}"` : 'this product'}. Photography will appear
          once added to catalogue.
        </p>
      </div>
    );
  }

  // Default 'md' size: used in ProductCard (compact card slot)
  return (
    <div
      className={`flex h-full w-full flex-col items-center justify-center rounded-xl p-3 ${config.bgClass} ${className}`}
      aria-label={`Category illustration: ${config.label}`}
      role="img"
    >
      <div className="transition duration-200 group-hover:scale-105">
        {config.renderIcon(`h-10 w-10 sm:h-12 sm:w-12 ${config.iconClass}`)}
      </div>
      <span
        className={`mt-1.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold tracking-tight uppercase ${config.badgeClass}`}
      >
        {config.label}
      </span>
    </div>
  );
}
