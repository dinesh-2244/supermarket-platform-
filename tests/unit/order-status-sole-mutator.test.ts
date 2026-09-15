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
const ORDERS_SERVICE = join('src', 'modules', 'orders', 'service.ts');

/** The text of a top-level `function`/`async function` body, brace-balanced. */
function bodyOf(source: string, name: string): string {
  const start = source.search(new RegExp(`(export\\s+)?(async\\s+)?function\\s+${name}\\b`));
  if (start < 0) return '';
  let depth = 0;
  let seen = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1;
      seen = true;
    } else if (source[i] === '}') {
      depth -= 1;
      if (seen && depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

/** Which top-level functions in `source` contain a call to `needle`. */
function functionsCalling(source: string, needle: string): string[] {
  const names = [...source.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/g)].map(
    (match) => match[1] ?? '',
  );
  return names.filter((name) => bodyOf(source, name).includes(needle));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    // `module-boundaries.test.ts` writes and removes `__boundary_fixture__`
    // files while it runs; in a parallel worker they can appear in this
    // listing and be gone by the time they are read. They are not source.
    if (entry.includes('__boundary_fixture__')) return [];
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
    expect(statusWrites.some((write) => write.includes('status: rule.to'))).toBe(true);
    expect(statusWrites.some((write) => write.includes("status: 'PLACED'"))).toBe(true);
  });

  it('setStatus cannot be called without a validated edge (structural, not a scan)', () => {
    // OSCAR R8.2: the previous version of this file only checked that the
    // *caller lived in service.ts*, so a second function there reusing the write
    // helper passed every test while skipping the edge check and the history
    // row. `setStatus` now takes a `ValidatedTransition` — a type branded with a
    // module-private symbol in state-machine.ts — and reads the target status
    // and timestamp column off it. Naming a status is no longer expressible.
    const repo = readFileSync(join(process.cwd(), ORDERS_REPO), 'utf8');
    expect(repo).toMatch(/export async function setStatus\([^)]*rule: ValidatedTransition/s);
    expect(repo).not.toMatch(/setStatus\([^)]*to: OrderStatus/s);

    const machine = readFileSync(
      join(process.cwd(), 'src', 'modules', 'orders', 'state-machine.ts'),
      'utf8',
    );
    // The brand is declared but never exported, so no other module can mint one.
    expect(machine).toContain('declare const validatedEdge: unique symbol');
    expect(machine).not.toMatch(/export\s+(const|let|function)\s+validatedEdge/);
    // …and it is minted in exactly one place: after the edge has been checked.
    expect(machine.match(/as ValidatedTransition/g)).toHaveLength(1);
  });

  it('exactly one function calls setStatus, and it writes the history row too', () => {
    // The invariant is not "only this file writes a status" — that is what let
    // R8.2 through — it is "only the validated transition does, and it records
    // what it did". Both halves are checked on the same function body.
    const source = readFileSync(join(process.cwd(), ORDERS_SERVICE), 'utf8');
    const owners = functionsCalling(source, 'repo.setStatus');

    expect(owners).toEqual(['transition']);
    const body = bodyOf(source, 'transition');
    expect(body).toContain('repo.insertStatusHistory');
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
