import Link from 'next/link';

/**
 * Reusable wave / horizon SVG motif reflecting a subtle maritime visual language.
 * Adheres strictly to guardrails: zero military emblems, insignia, uniforms, or warships.
 */
export function WaveHorizonGraphic({
  className = 'text-sky-500/20',
}: {
  className?: string;
}): React.ReactElement {
  return (
    <svg
      className={`pointer-events-none absolute inset-x-0 bottom-0 w-full overflow-hidden ${className}`}
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M0,40 C150,90 350,-20 500,45 C650,110 900,10 1200,50 L1200,120 L0,120 Z"
        fill="currentColor"
        opacity="0.3"
      />
      <path
        d="M0,60 C200,110 450,20 700,75 C950,130 1100,50 1200,70 L1200,120 L0,120 Z"
        fill="currentColor"
        opacity="0.5"
      />
    </svg>
  );
}

export interface PromoBannerCardProps {
  badge: string;
  title: string;
  description: string;
  buttonText: string;
  href: string;
  variant?: 'navy' | 'ocean' | 'slate';
  icon?: string;
}

/**
 * Reusable promotional banner card with deep-blue naval visual language.
 * Designed for reuse across future campaigns and marketing announcements.
 */
export function PromoBannerCard({
  badge,
  title,
  description,
  buttonText,
  href,
  variant = 'navy',
  icon,
}: PromoBannerCardProps): React.ReactElement {
  const gradientStyles = {
    navy: 'from-slate-950 via-slate-900 to-blue-950 text-white border-slate-800',
    ocean: 'from-slate-900 via-blue-950 to-sky-950 text-white border-sky-900/50',
    slate: 'from-slate-900 via-slate-800 to-slate-900 text-white border-slate-700',
  }[variant];

  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 shadow-xs border ${gradientStyles}`}
    >
      <WaveHorizonGraphic className="text-sky-400/10" />
      <div className="relative z-10">
        <span className="rounded-md bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-sky-200">
          {badge}
        </span>
        <h2 className="mt-2 text-xl font-black tracking-tight">{title}</h2>
        <p className="mt-1 text-xs text-slate-300 leading-relaxed max-w-sm">{description}</p>
        <Link
          href={href}
          className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-1.5 text-xs font-bold text-slate-900 shadow-xs hover:bg-sky-50 transition min-h-[44px]"
        >
          {icon ? <span>{icon}</span> : null}
          <span>{buttonText}</span>
        </Link>
      </div>
    </div>
  );
}

/**
 * Reusable container grid for promotional banners.
 */
export function PromoBannerGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</section>;
}
