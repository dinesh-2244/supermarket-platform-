import { describe, expect, it } from 'vitest';
import { scoped, scopedWhere, type DbExecutor, type Principal } from '@/modules/platform';

/**
 * The compile-time half of the store-scope guarantee (PR #50 round 8).
 *
 * `scoped(delegate)` reads take only a `ScopedWhere` — the branded type that
 * nothing but `scopedWhere` produces. The cases below are `@ts-expect-error`
 * on purpose: CI's `tsc --noEmit` covers this file, so if `scoped()` ever
 * stops requiring the brand, the directives go unused and the typecheck
 * fails. The guard test (`repo-scope-spread.test.ts`) holds the other half —
 * that every read on a principal's behalf goes through `scoped()` at all.
 */
declare const principal: Principal;
declare const db: DbExecutor;

// Never called: these functions exist to be typechecked.
async function refused(): Promise<void> {
  // @ts-expect-error — a hand-written where has no brand
  await scoped(db.order).findMany({ where: { storeId: 'x' } });
  // @ts-expect-error — a selection off the brand is not the brand
  await scoped(db.order).findMany({ where: scopedWhere(principal, { storeId: 'x' }).AND[1] });
  // @ts-expect-error — where is required
  await scoped(db.order).findMany({ take: 5 });
  // @ts-expect-error — an unknown field inside the scope's conditions
  await scoped(db.order).findMany({ where: scopedWhere(principal, { nonsense: 1 }) });
  // @ts-expect-error — the brand cannot be spread away
  await scoped(db.order).count({ where: { ...scopedWhere(principal, { storeId: 'x' }) } });
}

async function accepted(): Promise<string> {
  const rows = await scoped(db.order).findMany({
    where: scopedWhere(principal, { storeId: 'x' }),
    select: { id: true, orderNumber: true },
  });
  // `select` still narrows: `status` was not selected.
  // @ts-expect-error — not in the selection
  void rows[0]?.status;
  const grouped = await scoped(db.order).groupBy({
    by: ['status'],
    where: scopedWhere(principal, {}),
    _count: { _all: true },
  });
  const first = await scoped(db.store).findFirst({ where: scopedWhere(principal, {}, 'id') });
  return `${rows[0]?.orderNumber ?? ''}${grouped[0]?._count._all ?? 0}${first?.id ?? ''}`;
}

describe('scoped reads — the compile-time half', () => {
  it('is checked by tsc, not at runtime', () => {
    expect(typeof refused).toBe('function');
    expect(typeof accepted).toBe('function');
  });
});
