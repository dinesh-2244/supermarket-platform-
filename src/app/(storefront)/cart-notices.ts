import type { CartNotice, CartView, LineIssue, RemovedLine } from '@/modules/cart';
import { rupees } from './ui';

/**
 * Putting a basket mutation's revalidation into words (R1).
 *
 * Every basket mutation revalidates, and revalidation is **consuming**: the
 * price-changed notice exists because the stored snapshot differed from the
 * store's price, and bringing that snapshot up to date is what stops the notice
 * repeating on every subsequent page load. So the mutation that caused the
 * revalidation is the *only* moment those notices exist. An action that returned
 * "Basket updated." and dropped them left the shopper with a silently re-priced
 * basket — the page they landed on revalidated a second time, found nothing to
 * report, and told them nothing.
 *
 * Adding to the basket happens on the product page, where the response *is* the
 * rendered result and nothing unmounts the form, so that one keeps its summary
 * inline. The basket page's own mutations record theirs on the cart instead —
 * see `CartNotice` — because the remove button's form does not survive its own
 * action, and because the list of affected lines has no upper bound.
 */
export function changeSummary(view: CartView): string {
  return sentencesFor(view.removed, view.lines).join(' ');
}

/**
 * The same sentences, rebuilt from the record the mutation left on the basket.
 *
 * Every affected line is named, with no cap. The transport this replaced was a
 * cookie, and a cookie is a header — so it had a length limit, and a basket with
 * enough affected lines simply lost the ones past it. Raising the limit moves
 * the boundary rather than removing it, which is why the evidence now lives on
 * the cart row and this function has nothing to truncate.
 */
export function noticeSentences(notice: CartNotice): readonly string[] {
  return [
    ...notice.removed.map(removedSentence),
    ...notice.changed.flatMap((line) =>
      line.issues.map((issue) => issueSentence(line.name, issue)),
    ),
  ];
}

function sentencesFor(
  removed: readonly RemovedLine[],
  lines: readonly { name: string; issues: readonly LineIssue[] }[],
): readonly string[] {
  return [
    ...removed.map(removedSentence),
    ...lines.flatMap((line) => line.issues.map((issue) => issueSentence(line.name, issue))),
  ];
}

function removedSentence(row: RemovedLine): string {
  return row.reason === 'unlisted'
    ? `${row.name} is no longer sold at your shop, so we took it out.`
    : `${row.name} has been discontinued, so we took it out.`;
}

function issueSentence(name: string, issue: LineIssue): string {
  if (issue.kind === 'price-changed') {
    return `${name} changed from ${rupees(issue.oldPricePaise)} to ${rupees(issue.newPricePaise)} — your basket uses the new price.`;
  }
  if (issue.kind === 'insufficient-stock') {
    return `Only ${String(issue.available)} of ${name} available — reduce the quantity to continue.`;
  }
  return `${name} is out of stock at your shop right now.`;
}

/** `a. b.` reads badly when one half is empty; this keeps the joins clean. */
export function withSummary(lead: string, summary: string): string {
  return summary === '' ? lead : `${lead} ${summary}`;
}
