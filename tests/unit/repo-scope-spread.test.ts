import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `storeScopeFilter(principal)` must never be *spread* into a `where` that also
 * names `storeId`.
 *
 * Both produce a `storeId` key; whichever comes second wins, and the scope
 * filter — the repository's own second line against reading another store's
 * rows — is silently dropped. The fix is `AND: [storeScopeFilter(principal),
 * { storeId }]`, which keeps both conditions. This walks every repository and
 * fails on the pattern, so it cannot come back with the next module.
 */
const MODULES_DIR = join(process.cwd(), 'src', 'modules');

function repoFiles(): string[] {
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(MODULES_DIR, entry.name, 'repo.ts'))
    .filter((file) => {
      try {
        readFileSync(file);
        return true;
      } catch {
        return false;
      }
    });
}

/** The text of the object literal that starts at the `{` at `open`. */
function objectLiteralAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

function spreadsNextToStoreId(source: string): number[] {
  const offending: number[] = [];
  const spread = /\.\.\.storeScopeFilter\(/g;
  let match: RegExpExecArray | null;
  while ((match = spread.exec(source)) !== null) {
    // The `where: {` (or any `{`) this spread sits directly inside.
    const open = source.lastIndexOf('{', match.index);
    const literal = objectLiteralAt(source, open);
    if (/(^|[\s,{])storeId\s*[:,}]/.test(literal)) {
      offending.push(source.slice(0, match.index).split('\n').length);
    }
  }
  return offending;
}

describe('repository store scoping', () => {
  it('never spreads storeScopeFilter next to a storeId key', () => {
    const violations: string[] = [];
    for (const file of repoFiles()) {
      for (const line of spreadsNextToStoreId(readFileSync(file, 'utf8'))) {
        violations.push(`${file.replace(process.cwd() + '/', '')}:${line}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('flags the pattern it exists to catch', () => {
    const bad = `where: {\n  ...storeScopeFilter(principal),\n  storeId,\n}`;
    expect(spreadsNextToStoreId(bad)).toEqual([2]);
    const conditional = `where: {\n  ...storeScopeFilter(principal),\n  ...(x ? { storeId: x } : {}),\n}`;
    expect(spreadsNextToStoreId(conditional)).toEqual([2]);
    const fine = `where: {\n  id: orderId,\n  ...storeScopeFilter(principal),\n}`;
    expect(spreadsNextToStoreId(fine)).toEqual([]);
    const fixed = `where: {\n  AND: [storeScopeFilter(principal), { storeId }],\n}`;
    expect(spreadsNextToStoreId(fixed)).toEqual([]);
  });
});
