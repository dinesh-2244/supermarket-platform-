import type { CartView, LineIssue, RemovedLine } from '@/modules/cart';
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
 * The action's own message is the rendered response, so the summary goes there.
 * Deliberately not another flash cookie: the notice belongs to the submission
 * that produced it, and a cookie would show it again after an unrelated
 * navigation.
 */
export function changeSummary(view: CartView): string {
  return [...view.removed.map(removedSentence), ...lineSentences(view)].join(' ');
}

/** The same sentences, for a page that has no lines left to hang them on. */
export function removedSummary(removed: readonly RemovedLine[]): string {
  return removed.map(removedSentence).join(' ');
}

function removedSentence(row: RemovedLine): string {
  return row.reason === 'unlisted'
    ? `${row.name} is no longer sold at your shop, so we took it out.`
    : `${row.name} has been discontinued, so we took it out.`;
}

function lineSentences(view: CartView): readonly string[] {
  return view.lines.flatMap((line) => line.issues.map((issue) => issueSentence(line.name, issue)));
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
