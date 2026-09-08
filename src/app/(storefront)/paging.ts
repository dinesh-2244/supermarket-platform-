/**
 * A page number a visitor typed is a hint, not an index.
 *
 * Anything that is not a positive integer becomes page 1 rather than an error
 * or a negative `OFFSET`: `?page=-3`, `?page=abc` and `?page=` are all things
 * people and crawlers produce, and none of them deserve a 500.
 */
export function pageNumber(raw: string | string[] | undefined): number {
  const value = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 1;
}
