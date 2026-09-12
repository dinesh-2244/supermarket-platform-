import Link from 'next/link';
import { Card, PageHeading } from '../ui';

export const dynamic = 'force-dynamic';

/**
 * Reserved Information Architecture Slot: POS Integration (AD12).
 *
 * Per ADR-0007 and human-approved guardrails:
 * - No live POS vendor integration is pre-built before vendor selection.
 * - MANUAL mode (manual POS bill entry and CSV inventory reconciliation) is a
 *   permanent first-class operating mode, not a temporary stopgap.
 */
export default function PosIntegrationSlotPage(): React.ReactElement {
  return (
    <div className="space-y-6">
      <PageHeading
        title="POS Integration"
        subtitle="Point-of-Sale architecture & operations surface (AD12 / ADR-0007)."
        badge={
          <span className="rounded-full bg-blue-100 border border-blue-200 px-3 py-0.5 text-xs font-bold text-blue-900">
            Reserved Slot (ADR-0007)
          </span>
        }
      />

      <Card title="Permanent Manual Mode Architecture">
        <div className="space-y-4">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-5">
            <h3 className="text-sm font-bold text-emerald-950 flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white text-xs">
                ✓
              </span>
              <span>Manual mode is a permanent, fully supported operating standard</span>
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-emerald-900 leading-relaxed">
              Per <strong>ADR-0007</strong>, store configurations with <code>posMode = MANUAL</code>{' '}
              are not a temporary placeholder. Manual billing and reconciliation are designed to
              function permanently alongside any future automated adapter.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 pt-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-1.5">
                <svg
                  className="h-5 w-5 text-emerald-700"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                  />
                </svg>
                <span>Manual POS Bill Entry</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                Cashiers ring up ordered goods on standard retail billing terminals and input the
                final POS receipt total into the order lifecycle at the <code>BILLED_IN_POS</code>{' '}
                transition.
              </p>
              <Link
                href="/admin/orders"
                className="inline-flex min-h-[44px] items-center text-xs font-bold text-emerald-800 hover:text-emerald-950 underline"
              >
                Go to orders queue &rarr;
              </Link>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-1.5">
                <svg
                  className="h-5 w-5 text-emerald-700"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                  />
                </svg>
                <span>CSV Inventory Reconciliation</span>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed mb-4">
                Daily or weekly stock takes exported from the store billing system are imported via
                atomic CSV reconciliation, maintaining an immutable ledger record for every SKU.
              </p>
              <Link
                href="/admin/inventory"
                className="inline-flex min-h-[44px] items-center text-xs font-bold text-emerald-800 hover:text-emerald-950 underline"
              >
                Go to inventory import &rarr;
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-5 mt-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">
              Future Adapter Mode Roadmap
            </h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              When a dedicated POS hardware/software vendor is selected, a separate dedicated
              implementation plan will specify endpoint mappings, SKU translation tables, and
              webhook sync capabilities.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
