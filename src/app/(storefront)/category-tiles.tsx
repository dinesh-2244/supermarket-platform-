import Link from 'next/link';
import type { CategoryRecord } from '@/modules/catalog';

interface CategoryTileConfig {
  readonly icon: string;
  readonly bgClass: string;
  readonly textClass: string;
}

const CATEGORY_ICONS: Record<string, CategoryTileConfig> = {
  'fruits-vegetables': {
    icon: '🥦',
    bgClass: 'bg-emerald-50 border-emerald-200/80 hover:bg-emerald-100/80 hover:border-emerald-300',
    textClass: 'text-emerald-900',
  },
  'dairy-bakery': {
    icon: '🥛',
    bgClass: 'bg-sky-50 border-sky-200/80 hover:bg-sky-100/80 hover:border-sky-300',
    textClass: 'text-sky-900',
  },
  staples: {
    icon: '🌾',
    bgClass: 'bg-amber-50 border-amber-200/80 hover:bg-amber-100/80 hover:border-amber-300',
    textClass: 'text-amber-900',
  },
  'snacks-beverages': {
    icon: '🍪',
    bgClass: 'bg-orange-50 border-orange-200/80 hover:bg-orange-100/80 hover:border-orange-300',
    textClass: 'text-orange-900',
  },
  household: {
    icon: '🧼',
    bgClass: 'bg-indigo-50 border-indigo-200/80 hover:bg-indigo-100/80 hover:border-indigo-300',
    textClass: 'text-indigo-900',
  },
};

const DEFAULT_CONFIG: CategoryTileConfig = {
  icon: '🛒',
  bgClass: 'bg-slate-50 border-slate-200/80 hover:bg-slate-100/80 hover:border-slate-300',
  textClass: 'text-slate-900',
};

/**
 * Visual grocery category tiles (D4).
 * Replaces plain text chips with visual, touch-friendly grocery aisles.
 */
export function CategoryTiles({
  categories,
  activeSlug,
}: {
  categories: readonly CategoryRecord[];
  activeSlug?: string;
}): React.ReactElement {
  if (categories.length === 0) return <></>;

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base sm:text-lg font-bold text-slate-900">Shop by Category</h2>
        <Link
          href="/shop"
          className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
        >
          View all aisles →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
        {categories.map((category) => {
          const config = CATEGORY_ICONS[category.slug] ?? DEFAULT_CONFIG;
          const isActive = category.slug === activeSlug;

          return (
            <Link
              key={category.id}
              href={`/c/${category.slug}`}
              className={`flex items-center gap-3 rounded-2xl border p-3 transition shadow-xs ${
                isActive
                  ? 'border-emerald-600 bg-emerald-100/80 ring-2 ring-emerald-600/30'
                  : config.bgClass
              }`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-xl shadow-xs">
                {config.icon}
              </span>
              <div className="min-w-0">
                <span className={`block text-xs font-bold truncate ${config.textClass}`}>
                  {category.name}
                </span>
                <span className="block text-[10px] text-slate-500 font-medium">Explore aisle</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
