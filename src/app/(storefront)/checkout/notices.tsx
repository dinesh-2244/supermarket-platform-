import type { CartLine, CartNotice, LineIssue, RemovedLine } from '@/modules/cart';
import { noticeSentences } from '../cart-notices';
import { rupees } from '../ui';

/**
 * Everything the revalidation found, on the checkout page (R5).
 *
 * Loading checkout revalidates the basket, and revalidation is **consuming**: it
 * brings the stored snapshot up to date, which is what stops a price-change
 * notice repeating on every page load. So the render that caused it is the only
 * moment those findings exist. The first version of this page read `viewCart`
 * for its lines and totals and dropped `removed`, `lines[].issues` and the
 * stored `notice` on the floor — the same defect as Phase 3's R1, one page
 * along: a shopper could arrive at checkout and be quoted a price that had
 * changed since they looked, with nothing said.
 *
 * These are the basket page's own components, reused rather than reimplemented,
 * so the two pages cannot drift into describing the same event differently.
 */
export function RevalidationNotices({
  notice,
  removed,
}: {
  notice: CartNotice | null;
  removed: readonly RemovedLine[];
}): React.ReactElement | null {
  if (notice === null && removed.length === 0) return null;

  return (
    <>
      {notice === null ? null : <ChangeNotice notice={notice} />}
      {removed.length === 0 ? null : <RemovedNotice removed={removed} />}
    </>
  );
}

function ChangeNotice({ notice }: { notice: CartNotice }): React.ReactElement {
  return (
    <div
      role="status"
      className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      <ul className="flex flex-col gap-1">
        {noticeSentences(notice).map((sentence) => (
          <li key={sentence}>{sentence}</li>
        ))}
      </ul>
    </div>
  );
}

function RemovedNotice({ removed }: { removed: readonly RemovedLine[] }): React.ReactElement {
  return (
    <p
      role="status"
      className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      We had to take {removed.length === 1 ? 'an item' : 'some items'} out of your basket:{' '}
      {removed
        .map(
          (row) =>
            `${row.name} (${row.reason === 'unlisted' ? 'no longer sold here' : 'discontinued'})`,
        )
        .join(', ')}
      .
    </p>
  );
}

/**
 * What is wrong with one line, said next to that line.
 *
 * A shortage is never silently capped: a shopper who asked for 12 and can have 8
 * decides whether 8 is worth having — the same rule the basket page follows.
 */
export function LineIssues({ line }: { line: CartLine }): React.ReactElement | null {
  if (line.issues.length === 0) return null;

  return (
    <>
      {line.issues.map((issue) => (
        <span key={issue.kind} className="mt-0.5 block text-xs text-amber-800">
          {sentenceFor(issue)}
        </span>
      ))}
    </>
  );
}

function sentenceFor(issue: LineIssue): string {
  if (issue.kind === 'price-changed') {
    return `Price changed from ${rupees(issue.oldPricePaise)} to ${rupees(
      issue.newPricePaise,
    )} — your basket uses the new price.`;
  }
  if (issue.kind === 'insufficient-stock') {
    return `Only ${String(issue.available)} left — reduce the quantity in your basket to continue.`;
  }
  return 'Out of stock at your shop right now.';
}

/** Does anything here stop the order being placed? A price move does not. */
export function blockingIssues(lines: readonly CartLine[]): readonly CartLine[] {
  return lines.filter((line) => line.issues.some((issue) => issue.kind !== 'price-changed'));
}
