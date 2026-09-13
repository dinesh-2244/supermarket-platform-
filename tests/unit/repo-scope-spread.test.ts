import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Store scoping in repositories goes through `scopedWhere`, and nothing else.
 *
 * `{ ...storeScopeFilter(principal), storeId }` produced two `storeId` keys
 * and kept the second — the scope silently gone. A first guard pattern-matched
 * that spread; OSCAR defeated it with `const scope = storeScopeFilter(p);
 * where: { ...scope, storeId }`. Text patterns can always be aliased around,
 * so this guard does not look for the *shape* of the bug — it removes the
 * primitive: outside `platform/authz` (where it is defined) no module file
 * may name `storeScopeFilter` at all. The only sanctioned use is
 * `scopedWhere(principal, { …conditions })`, which puts the scope and the
 * caller's conditions in an `AND` where nothing can overwrite anything.
 *
 * A second rule closes the same hole one level up. `scopedWhere(...)` is a
 * complete `where`, and the only sanctioned shape is the literal, direct
 * initializer of a `where:` property — `where: scopedWhere(principal, {…})`
 * inline at the call site. Anything else done with its result (assigned to
 * a variable, returned from a helper, spread, wrapped, forwarded) is the
 * violation in itself: `const scope = scopedWhere(p, x); where: { ...scope,
 * AND: [...] }` overwrites the `AND` the scope lives in, and no rule that
 * looks at what happens *after* the call can keep up with the ways to do
 * that. So the rule looks only at what comes *before* it.
 */
const MODULES_DIR = join(process.cwd(), 'src', 'modules');
const DEFINED_IN = join(MODULES_DIR, 'platform', 'authz', 'index.ts');
const PLATFORM_INDEX = join(MODULES_DIR, 'platform', 'index.ts');

function moduleFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === '__tests__' ? [] : moduleFiles(full);
    }
    return /\.tsx?$/.test(entry) && !entry.includes('__boundary_fixture__') ? [full] : [];
  });
}

/** Line numbers on which `source` names the primitive. */
export function namesStoreScopeFilter(source: string): number[] {
  const lines: number[] = [];
  source.split('\n').forEach((line, i) => {
    if (/\bstoreScopeFilter\b/.test(line)) lines.push(i + 1);
  });
  return lines;
}

/**
 * Line numbers of every `scopedWhere(` that is not the direct value of a
 * `where:` property. The text before the call, with whitespace removed, must
 * end in `where:` — nothing else is sanctioned.
 */
export function misusesScopedWhere(source: string): number[] {
  const lines: number[] = [];
  const call = /\bscopedWhere\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(source)) !== null) {
    const before = source.slice(0, match.index).replace(/\s+$/, '');
    if (!/\bwhere:$/.test(before)) {
      lines.push(source.slice(0, match.index).split('\n').length);
    }
  }
  return lines;
}

describe('repository store scoping', () => {
  const files = moduleFiles(MODULES_DIR).filter(
    (file) => file !== DEFINED_IN && file !== PLATFORM_INDEX,
  );

  it('names storeScopeFilter nowhere outside platform/authz — scopedWhere is the only door', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const line of namesStoreScopeFilter(readFileSync(file, 'utf8'))) {
        violations.push(`${relative(process.cwd(), file)}:${line}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('uses scopedWhere only as the direct value of a where: property', () => {
    const violations: string[] = [];
    for (const file of files) {
      for (const line of misusesScopedWhere(readFileSync(file, 'utf8'))) {
        violations.push(`${relative(process.cwd(), file)}:${line}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('catches the original bug, the alias bypass, a renamed import and a destructured one', () => {
    const original = `where: {\n  ...storeScopeFilter(principal),\n  storeId,\n}`;
    expect(namesStoreScopeFilter(original)).toEqual([2]);

    // OSCAR's bypass of the first guard: same bug, no literal spread of the call.
    const alias = `const scope = storeScopeFilter(principal);\nwhere: { ...scope, storeId }`;
    expect(namesStoreScopeFilter(alias)).toEqual([1]);

    const renamed = `import { storeScopeFilter as scope } from '../platform/index';\nwhere: { ...scope(principal), storeId }`;
    expect(namesStoreScopeFilter(renamed)).toEqual([1]);

    const destructured = `const { storeScopeFilter: f } = platform;`;
    expect(namesStoreScopeFilter(destructured)).toEqual([1]);

    // The sanctioned form names only scopedWhere, directly after `where:`.
    const fine = `where: scopedWhere(principal, { storeId, status: { in: statuses } })`;
    expect(namesStoreScopeFilter(fine)).toEqual([]);
    expect(misusesScopedWhere(fine)).toEqual([]);
    const multiline = `    where: scopedWhere(principal, {\n      storeId,\n    }),`;
    expect(misusesScopedWhere(multiline)).toEqual([]);
    const spaced = `where:\n      scopedWhere(principal, {}, 'id')`;
    expect(misusesScopedWhere(spaced)).toEqual([]);

    // Spreading the helper reopens the overwrite one level up.
    const spread = `where: { ...scopedWhere(principal, { storeId }), AND: [other] }`;
    expect(misusesScopedWhere(spread)).toEqual([1]);

    // OSCAR's round-3 trick: park the result in a variable, then spread that
    // beside a second AND. The assignment is the violation — before the AND
    // key is ever written.
    const parked = `const scope = scopedWhere(principal, { storeId });\nwhere: { ...scope, AND: [{ storeId }] }`;
    expect(misusesScopedWhere(parked)).toEqual([1]);

    // Returned from a helper, wrapped, or forwarded: all the same violation.
    expect(misusesScopedWhere(`return scopedWhere(principal, extra);`)).toEqual([1]);
    expect(misusesScopedWhere(`where: widen(scopedWhere(principal, extra))`)).toEqual([1]);
    expect(misusesScopedWhere(`run(principal, scopedWhere(principal, extra))`)).toEqual([1]);
    // An import line is not a call.
    expect(misusesScopedWhere(`import { scopedWhere } from '../platform/index';`)).toEqual([]);
  });
});
