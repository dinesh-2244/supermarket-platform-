import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
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
 * a variable, returned from a helper, spread, wrapped, forwarded, or — OSCAR's
 * round-4 find — narrowed with `.AND[1]` right after the closing paren) is
 * the violation in itself. Text rules lost every round: "no spread" was
 * aliased around, "must follow `where:`" was appended to. So this rule reads
 * no text at all. It parses the file and demands, for every identifier named
 * `scopedWhere` that is not an import, that its parent is a call and that
 * call's parent is a `where:` property whose initializer IS that call node —
 * not a member access on it, not an element access, not an await, not a
 * parenthesis, not anything. The whole initializer is the one call, full stop.
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

/** True when `node` is the whole initializer of a `where:` property. */
function isWhereInitializer(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === node &&
    (ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name)) &&
    parent.name.text === 'where'
  );
}

/**
 * The local names under which `scopedWhere` is bound in this file: the import
 * specifier's local name, alias or not. Every use of an alias is judged
 * exactly like the real name. The alias itself is reported by the walk below:
 * in `scopedWhere as x` the identifier `scopedWhere` is the specifier's
 * `propertyName`, not its `name`, and nothing sanctions that — there is no
 * reason to rename a function that must appear inline at every call site.
 */
function scopedWhereBindings(file: ts.SourceFile): Set<string> {
  const names = new Set<string>(['scopedWhere']);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const spec of bindings.elements) {
      if ((spec.propertyName ?? spec.name).text === 'scopedWhere') names.add(spec.name.text);
    }
  }
  return names;
}

/**
 * Line numbers of every use of `scopedWhere` — under its own name or any local
 * alias of the import — that is not the callee of a call sitting directly as
 * the initializer of a `where:` property. Decided on the syntax tree, not on
 * text: the call node itself must be the property's initializer, so nothing
 * can be wrapped around it or appended to it. The named-import specifier is
 * the one other place the name may appear; a namespace member, a string key,
 * a re-export or a destructured dynamic import are not it.
 */
export function misusesScopedWhere(source: string): number[] {
  const file = ts.createSourceFile('guard.ts', source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const names = scopedWhereBindings(file);
  const report = (node: ts.Node): void => {
    lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && names.has(node.text)) {
      const parent = node.parent;
      const isImportName = ts.isImportSpecifier(parent) && parent.name === node;
      const sanctioned =
        ts.isCallExpression(parent) && parent.expression === node && isWhereInitializer(parent);
      if (!isImportName && !sanctioned) report(node);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === 'scopedWhere'
    ) {
      // `authz['scopedWhere']` and friends: the name as data, not as a binding.
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * For the two platform files the consumer scan skips — where `scopedWhere` is
 * defined and re-exported — every mention of the name must be the definition
 * itself (`export function scopedWhere`) or an unaliased export specifier
 * (`export { scopedWhere }`). `export { scopedWhere as x }`, `export { x as
 * scopedWhere }`, `export const x = scopedWhere`, a namespace member, a
 * string key or a default export all hand the function out under another
 * name, which no consumer-side rule can know about (OSCAR round 6).
 */
export function misexportsScopedWhere(source: string): number[] {
  const file = ts.createSourceFile('platform.ts', source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const report = (node: ts.Node): void => {
    lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'scopedWhere') {
      const parent = node.parent;
      const definition = ts.isFunctionDeclaration(parent) && parent.name === node;
      const plainExport =
        ts.isExportSpecifier(parent) && parent.propertyName === undefined && parent.name === node;
      if (!definition && !plainExport) report(node);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === 'scopedWhere'
    ) {
      report(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(lines)].sort((a, b) => a - b);
}

/** Is `node` inside the declaration of the function named `name`? */
function withinFunction(node: ts.Node, name: string): boolean {
  for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name?.text === name) return true;
  }
  return false;
}

/**
 * For the file that defines `storeScopeFilter`: every identifier of that name
 * must be either the name of its own **unexported** function declaration, or
 * sit inside the declaration of `scopedWhere` (body or signature). Anything
 * else — an `export` on the definition, a second wrapper, an alias, an export
 * list, a method — hands the raw fragment out under some other name, which no
 * rule about the name `scopedWhere` can see (OSCAR round 7).
 */
export function misplacesStoreScopeFilter(source: string): number[] {
  const file = ts.createSourceFile('authz.ts', source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'storeScopeFilter') {
      const parent = node.parent;
      const definition =
        ts.isFunctionDeclaration(parent) &&
        parent.name === node &&
        !(parent.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!definition && !withinFunction(node, 'scopedWhere')) {
        lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(lines)].sort((a, b) => a - b);
}

describe('repository store scoping', () => {
  const files = moduleFiles(MODULES_DIR).filter(
    (file) => file !== DEFINED_IN && file !== PLATFORM_INDEX,
  );

  it('names storeScopeFilter nowhere but its definition file — scopedWhere is the only door', () => {
    // platform/index.ts included: the primitive is module-private and has no
    // re-export to offer (OSCAR round 7).
    const violations: string[] = [];
    for (const file of [...files, PLATFORM_INDEX]) {
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

    const fine = `where: scopedWhere(principal, { storeId, status: { in: statuses } })`;
    expect(namesStoreScopeFilter(fine)).toEqual([]);
  });

  /** A repo-shaped file around one `findMany` argument object. */
  const repo = (args: string): string =>
    `import { scopedWhere } from '../platform/index';\n` +
    `export function list(principal, storeId) {\n` +
    `  return prisma.order.findMany({\n${args}\n  });\n}`;

  it('accepts scopedWhere only as the entire initializer of a where: property', () => {
    expect(
      misusesScopedWhere(
        repo(`    where: scopedWhere(principal, { storeId, status: { in: statuses } }),`),
      ),
    ).toEqual([]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, {\n      storeId,\n    }),`)),
    ).toEqual([]);
    expect(misusesScopedWhere(repo(`    where:\n      scopedWhere(principal, {}, 'id'),`))).toEqual(
      [],
    );
    expect(misusesScopedWhere(repo(`    'where': scopedWhere(principal, { storeId }),`))).toEqual(
      [],
    );
    // A nested relation filter is still a where.
    expect(
      misusesScopedWhere(
        repo(`    select: { order: { where: scopedWhere(principal, { storeId }) } },`),
      ),
    ).toEqual([]);
    // The import line is not a use.
    expect(misusesScopedWhere(`import { scopedWhere } from '../platform/index';`)).toEqual([]);
  });

  it('rejects every other use of the name — by node shape, not text', () => {
    // Spreading the helper reopens the overwrite one level up.
    expect(
      misusesScopedWhere(
        repo(`    where: { ...scopedWhere(principal, { storeId }), AND: [other] },`),
      ),
    ).toEqual([4]);

    // OSCAR's round-3 trick: park the result in a variable, then spread that
    // beside a second AND. The assignment is the violation — before the AND
    // key is ever written.
    const parked =
      `import { scopedWhere } from '../platform/index';\n` +
      `const scope = scopedWhere(principal, { storeId });\n` +
      `const q = { where: { ...scope, AND: [{ storeId }] } };`;
    expect(misusesScopedWhere(parked)).toEqual([2]);

    // OSCAR's round-4 trick: the initializer still *starts* with the call, but
    // is a property/element access on it — `.AND[1]` selects the caller's own
    // branch and silently drops the principal scope. Typechecks, compiles.
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId }).AND[1],`)),
    ).toEqual([4]);
    expect(misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId }).AND,`))).toEqual(
      [4],
    );
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId })['AND'][1],`)),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId })!.AND[1],`)),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId }) as never,`)),
    ).toEqual([4]);

    // Any other wrapping of the call is the same shape of violation.
    expect(misusesScopedWhere(repo(`    where: (scopedWhere(principal, { storeId })),`))).toEqual([
      4,
    ]);
    expect(
      misusesScopedWhere(repo(`    where: await scopedWhere(principal, { storeId }),`)),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: widen(scopedWhere(principal, { storeId })),`)),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: cond ? scopedWhere(principal, { storeId }) : {},`)),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId }) ?? {},`)),
    ).toEqual([4]);
    expect(misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId })(),`))).toEqual([
      4,
    ]);

    // Right call, wrong property.
    expect(misusesScopedWhere(repo(`    orderBy: scopedWhere(principal, { storeId }),`))).toEqual([
      4,
    ]);
    expect(
      misusesScopedWhere(repo(`    where: { order: scopedWhere(principal, { storeId }) },`)),
    ).toEqual([4]);

    // Returned from a helper, forwarded, aliased, or passed as a value.
    expect(misusesScopedWhere(`function scope(p) { return scopedWhere(p, extra); }`)).toEqual([1]);
    expect(misusesScopedWhere(`run(principal, scopedWhere(principal, extra));`)).toEqual([1]);
    expect(misusesScopedWhere(`const f = scopedWhere;`)).toEqual([1]);
    expect(misusesScopedWhere(`const q = { scopedWhere };`)).toEqual([1]);
    expect(misusesScopedWhere(`const q = { where: scopedWhere };`)).toEqual([1]);
    expect(misusesScopedWhere(repo(`    where: widen(scopedWhere),`))).toEqual([4]);
  });

  it('the definition file uses storeScopeFilter only to define it and inside scopedWhere — OSCAR round 7', () => {
    // Exported, the primitive can be wrapped by any function in its own file
    // and re-exported under any name — no rule about names catches that. So
    // it is module-private, and this holds that nothing in the file but its
    // own definition and the body/signature of `scopedWhere` names it.
    expect(misplacesStoreScopeFilter(readFileSync(DEFINED_IN, 'utf8'))).toEqual([]);

    // OSCAR's three-file bypass, authz half: a second wrapper beside the
    // canonical one. (The other two halves — a re-export under an unrelated
    // name, and `.AND[1]` on it in a repo — are invisible to rules about the
    // name `scopedWhere`; this is what catches it.)
    const wrapper =
      `function storeScopeFilter(p, field = 'storeId') { return {}; }\n` +
      `export function scopedWhere(p, extra, field = 'storeId') {\n` +
      `  return { AND: [storeScopeFilter(p, field), extra] };\n` +
      `}\n` +
      `export function safeScope(p, extra) {\n` +
      `  return { AND: [storeScopeFilter(p), extra] };\n` +
      `}`;
    expect(misplacesStoreScopeFilter(wrapper)).toEqual([6]);

    // The honest file: a private definition, used once, inside scopedWhere.
    expect(misplacesStoreScopeFilter(wrapper.split('\nexport function safeScope')[0]!)).toEqual([]);
    // A type reference inside scopedWhere's own signature is inside scopedWhere.
    expect(
      misplacesStoreScopeFilter(
        `function storeScopeFilter(p) { return {}; }\n` +
          `export function scopedWhere(p, extra): { AND: [ReturnType<typeof storeScopeFilter>, unknown] } {\n` +
          `  return { AND: [storeScopeFilter(p), extra] };\n}`,
      ),
    ).toEqual([]);

    // Exporting the definition is itself the violation.
    expect(misplacesStoreScopeFilter(`export function storeScopeFilter(p) { return {}; }`)).toEqual(
      [1],
    );
    // So is handing it out any other way: an alias, an export list, a method.
    expect(
      misplacesStoreScopeFilter(
        `function storeScopeFilter(p) { return {}; }\nexport const scope = storeScopeFilter;`,
      ),
    ).toEqual([2]);
    expect(
      misplacesStoreScopeFilter(
        `function storeScopeFilter(p) { return {}; }\nexport { storeScopeFilter as safe };`,
      ),
    ).toEqual([2]);
    expect(
      misplacesStoreScopeFilter(
        `function storeScopeFilter(p) { return {}; }\nexport const authz = { scope: (p) => storeScopeFilter(p) };`,
      ),
    ).toEqual([2]);
    // A nested function inside scopedWhere that leaks it out is still inside
    // scopedWhere lexically — but scopedWhere returning anything other than
    // the AND shape is rule 2's business at every call site, not this rule's.
  });

  it('platform exports scopedWhere under its own name only — OSCAR round 6', () => {
    // The two files the scan above skips are the definition and the
    // re-export point. An aliased re-export there hands consumers the same
    // function under a name no consumer-side rule can know about.
    const violations: string[] = [];
    for (const file of [DEFINED_IN, PLATFORM_INDEX]) {
      for (const line of misexportsScopedWhere(readFileSync(file, 'utf8'))) {
        violations.push(`${relative(process.cwd(), file)}:${line}`);
      }
    }
    expect(violations).toEqual([]);

    // OSCAR's two-file bypass, both halves. The consumer half is invisible to
    // the consumer-side scan by design (no export-graph resolution); the
    // platform half is what catches it.
    const platformHalf = `export { scopedWhere as safeScope } from './authz/index';`;
    expect(misexportsScopedWhere(platformHalf)).toEqual([1]);
    const consumerHalf = repo(`    where: safeScope(principal, { storeId }).AND[1],`).replace(
      'import { scopedWhere }',
      'import { safeScope }',
    );
    expect(misusesScopedWhere(consumerHalf)).toEqual([]);

    // The honest shapes: the definition, and the unaliased re-export.
    expect(misexportsScopedWhere(`export function scopedWhere(p, extra) { return {}; }`)).toEqual(
      [],
    );
    expect(
      misexportsScopedWhere(`export { authorize, scopedWhere } from './authz/index';`),
    ).toEqual([]);
    expect(misexportsScopedWhere(`export * from './authz/index';`)).toEqual([]);

    // Every other way of handing the function out under another name.
    expect(
      misexportsScopedWhere(
        `import { scopedWhere } from './authz/index';\nexport { scopedWhere as safeScope };`,
      ),
    ).toEqual([1, 2]);
    expect(misexportsScopedWhere(`export { other as scopedWhere } from './authz/index';`)).toEqual([
      1,
    ]);
    expect(
      misexportsScopedWhere(
        `import { scopedWhere } from './authz/index';\nexport const safeScope = scopedWhere;`,
      ),
    ).toEqual([1, 2]);
    expect(
      misexportsScopedWhere(
        `import * as authz from './authz/index';\nexport const safeScope = authz.scopedWhere;`,
      ),
    ).toEqual([2]);
    expect(
      misexportsScopedWhere(
        `import * as authz from './authz/index';\nexport const safeScope = authz['scopedWhere'];`,
      ),
    ).toEqual([2]);
    expect(misexportsScopedWhere(`export default scopedWhere;`)).toEqual([1]);
    expect(misexportsScopedWhere(`export const scopedWhere = (p, extra) => ({});`)).toEqual([1]);
  });

  it('follows the import binding, whatever it is called locally — OSCAR round 5', () => {
    // The import is renamed, the honest call sites use the alias, and one
    // site appends `.AND[1]` — the round-4 bypass, under a name the guard
    // never looked at. The alias is a violation in itself (there is no reason
    // to rename a function that must appear inline at every call site), and
    // every use of the alias is checked exactly like the real name.
    const aliased =
      `import { scopedWhere as aliasedScopedWhere } from '../platform/index';\n` +
      `export function a(principal, storeId) {\n` +
      `  return prisma.order.findMany({ where: aliasedScopedWhere(principal, { storeId }) });\n` +
      `}\n` +
      `export function b(principal, storeId) {\n` +
      `  return prisma.order.findMany({ where: aliasedScopedWhere(principal, { storeId }).AND[1] });\n` +
      `}`;
    expect(misusesScopedWhere(aliased)).toEqual([1, 6]);

    // The same binding, reached other ways: a namespace import, a string key,
    // a default-style re-export, a dynamic import destructure.
    expect(
      misusesScopedWhere(
        `import * as authz from '../platform/index';\nconst q = { where: authz.scopedWhere(p, x) };`,
      ),
    ).toEqual([2]);
    expect(
      misusesScopedWhere(
        `import * as authz from '../platform/index';\nconst q = { where: authz['scopedWhere'](p, x).AND[1] };`,
      ),
    ).toEqual([2]);
    expect(
      misusesScopedWhere(`const { scopedWhere: sw } = await import('../platform/index');`),
    ).toEqual([1]);
    expect(misusesScopedWhere(`export { scopedWhere as sw } from '../platform/index';`)).toEqual([
      1,
    ]);
    expect(
      misusesScopedWhere(
        `import * as authz from '../platform/index';\nconst q = { where: authz.scopedWhere(p, x).AND[1] };`,
      ),
    ).toEqual([2]);
  });
});
