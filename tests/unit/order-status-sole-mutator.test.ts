import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Phase 4 Definition of Done — **`transition()` is the only code path that
 * mutates `Order.status`** (phase-4-plan D1).
 *
 * The reason this is a source scan rather than a runtime test: the failure it
 * guards against is somebody *adding* a second write path later. A runtime test
 * can only exercise the paths it knows about, and the one that breaks the
 * invariant will be the one nobody wrote a test for. What is checkable
 * mechanically is that no Prisma write anywhere in `src/` sets a `status` on the
 * `order` delegate except the two places entitled to:
 *
 * - `orders/repo.ts` `setStatus`, which only `transition()` calls, and
 * - `orders/repo.ts` `insertOrder`, which sets the **initial** `PLACED` — an
 *   order's first status is not a transition, and the table has no `null →
 *   PLACED` edge.
 *
 * A status change that skipped `transition()` would skip the
 * `OrderStatusHistory` row written in the same transaction, and the history is
 * the audit trail (§11).
 */
const SRC = join(process.cwd(), 'src');
const ORDERS_REPO = join('src', 'modules', 'orders', 'repo.ts');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) ? [full] : [];
  });
}

/**
 * Every `.order.update(...)` / `.order.updateMany(...)` / `.order.upsert(...)`
 * call site, with the argument text that follows it, so the assertion can ask
 * what each one writes rather than merely that it exists.
 */
function orderWrites(source: string): string[] {
  const found: string[] = [];
  const call = /\.order\.(update|updateMany|upsert|create|createMany)\b/g;
  let match: RegExpExecArray | null;

  while ((match = call.exec(source)) !== null) {
    // Take the balanced argument list that follows, so `data: { status: ... }`
    // is inside the slice even when the call spans many lines.
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') depth += 1;
      else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(source.slice(match.index, end + 1));
  }
  return found;
}

describe('Order.status has exactly one mutator', () => {
  const files = sourceFiles(SRC);

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no file outside orders/repo.ts writes a status on the order delegate', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const rel = relative(process.cwd(), file);
      if (rel === ORDERS_REPO) continue;

      for (const write of orderWrites(readFileSync(file, 'utf8'))) {
        if (/\bstatus\s*:/.test(write)) offenders.push(`${rel}: ${write.slice(0, 80)}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('orders/repo.ts writes a status in exactly two places, and says which', () => {
    const source = readFileSync(join(process.cwd(), ORDERS_REPO), 'utf8');
    const statusWrites = orderWrites(source).filter((write) => /\bstatus\s*:/.test(write));

    // `setStatus` (the transition) and `insertOrder` (the initial PLACED).
    expect(statusWrites).toHaveLength(2);
    expect(source).toContain('export async function setStatus');
    expect(statusWrites.some((write) => write.includes('status: to'))).toBe(true);
    expect(statusWrites.some((write) => write.includes("status: 'PLACED'"))).toBe(true);
  });

  it('only orders/service.ts calls setStatus', () => {
    const callers = sourceFiles(SRC)
      .filter((file) =>
        /\brepo\.setStatus\s*\(|[^.]\bsetStatus\s*\(/.test(readFileSync(file, 'utf8')),
      )
      .map((file) => relative(process.cwd(), file))
      .filter((rel) => rel !== ORDERS_REPO);

    expect(callers).toEqual([join('src', 'modules', 'orders', 'service.ts')]);
  });

  it('no raw SQL anywhere updates the Order table', () => {
    // `FOR UPDATE` reads are fine; an `UPDATE "Order"` would bypass every check
    // above, so it is refused outright.
    const offenders = files
      .filter((file) => /UPDATE\s+"Order"/i.test(readFileSync(file, 'utf8')))
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
