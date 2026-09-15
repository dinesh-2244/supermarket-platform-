import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
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
const PLATFORM_INDEX_NO_EXT = join(MODULES_DIR, 'platform', 'index');

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
 * The local names under which the *genuine* `scopedWhere` is bound in this
 * file: import specifiers whose imported name is `scopedWhere` **and** whose
 * module specifier path-resolves, from the importing file, to
 * platform/index.ts. Local spelling is never the identity — `import { safeScope
 * as scopedWhere } from './scope-helper'` binds the name `scopedWhere` to
 * something else entirely (OSCAR round 11) — so a local `scopedWhere` that is
 * not one of these is judged like any other misuse. Aliases of the genuine
 * import are tracked so every use of them is judged the same way; the alias
 * itself is reported by the walk (its `scopedWhere` is the specifier's
 * propertyName, not its name).
 */
function genuineScopedWhereBindings(file: ts.SourceFile, fromFile: string): Set<string> {
  const names = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const fromPlatform =
      resolve(dirname(fromFile), statement.moduleSpecifier.text) === PLATFORM_INDEX_NO_EXT;
    const bindings = statement.importClause?.namedBindings;
    if (!fromPlatform || bindings === undefined || !ts.isNamedImports(bindings)) continue;
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
export function misusesScopedWhere(source: string, fromFile: string): number[] {
  const file = ts.createSourceFile(fromFile, source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const genuine = genuineScopedWhereBindings(file, fromFile);
  const report = (node: ts.Node): void => {
    lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (genuine.has(node.text) || node.text === 'scopedWhere')) {
      const parent = node.parent;
      // The name `scopedWhere` bound to anything but the genuine import — a
      // helper's export aliased to it, a local declaration — is a violation
      // wherever it appears, including at its import.
      const counterfeit = !genuine.has(node.text);
      const isImportName = ts.isImportSpecifier(parent) && parent.name === node;
      const sanctioned =
        ts.isCallExpression(parent) && parent.expression === node && isWhereInitializer(parent);
      if (counterfeit || (!isImportName && !sanctioned)) report(node);
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

/** Is `node` inside the function or type-alias declaration named `name`? */
function withinDeclaration(node: ts.Node, name: string): boolean {
  for (let cursor: ts.Node | undefined = node.parent; cursor; cursor = cursor.parent) {
    if (ts.isFunctionDeclaration(cursor) && cursor.name?.text === name) return true;
    if (ts.isTypeAliasDeclaration(cursor) && cursor.name.text === name) return true;
  }
  return false;
}

/**
 * For the file that defines `storeScopeFilter`: every identifier of that name
 * must be either the name of its own **unexported** function declaration, or
 * sit inside the declaration of `scopedWhere` (body or signature) or of the
 * `ScopedWhere` type that spells its result's shape. Anything
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
      // Its own definition; the body/signature of `scopedWhere`; or the
      // `ScopedWhere` type, which names it only to spell the result's shape.
      if (
        !definition &&
        !withinDeclaration(node, 'scopedWhere') &&
        !withinDeclaration(node, 'ScopedWhere')
      ) {
        lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(lines)].sort((a, b) => a - b);
}

const READ_METHODS = new Set(['findMany', 'findFirst', 'count', 'groupBy', 'aggregate']);

type FunctionLike =
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function takesPrincipal(fn: FunctionLike): boolean {
  return fn.parameters.some(
    (p) =>
      p.type !== undefined &&
      ts.isTypeReferenceNode(p.type) &&
      ts.isIdentifier(p.type.typeName) &&
      p.type.typeName.text === 'Principal',
  );
}

/**
 * For a repository file: inside every function — declaration, expression,
 * arrow or method — that takes a `Principal`, each call to a read method
 * (`findMany`, `findFirst`, `count`, `groupBy`, `aggregate`) must be made on
 * `scoped(…)` and its argument must carry a `where:` whose initializer **is**
 * a `scopedWhere(…)` call — not merely present: `where: { storeId } as never`
 * satisfies the brand, because `never` is assignable to anything, and no type
 * can refuse a deliberate cast (OSCAR round 9). A read made any other way on
 * a principal's behalf is one that could have left the scope out (round 8).
 * Reads in functions without a principal — by id, by token — are not
 * store-scoped reads and are not judged here.
 */
export function unscopedReadsForPrincipal(source: string, fromFile: string): number[] {
  const file = ts.createSourceFile(fromFile, source, ts.ScriptTarget.Latest, true);
  const names = genuineScopedWhereBindings(file, fromFile);
  const lines: number[] = [];
  const judge = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      READ_METHODS.has(node.expression.name.text)
    ) {
      const target = node.expression.expression;
      const viaScoped =
        ts.isCallExpression(target) &&
        ts.isIdentifier(target.expression) &&
        target.expression.text === 'scoped';
      const arg = node.arguments[0];
      const where =
        arg !== undefined && ts.isObjectLiteralExpression(arg)
          ? arg.properties.find(
              (p) =>
                ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'where',
            )
          : undefined;
      const whereIsScopedWhere =
        where !== undefined &&
        ts.isPropertyAssignment(where) &&
        ts.isCallExpression(where.initializer) &&
        ts.isIdentifier(where.initializer.expression) &&
        names.has(where.initializer.expression.text);
      if (!viaScoped || !whereIsScopedWhere) {
        lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
      }
    }
    ts.forEachChild(node, judge);
  };
  const visit = (node: ts.Node): void => {
    if (isFunctionLike(node) && takesPrincipal(node) && node.body !== undefined) {
      judge(node.body);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(lines)].sort((a, b) => a - b);
}

/**
 * Where a file gets `scopedWhere` from, and what it does with the name — the
 * provenance chain (OSCAR round 10). Three hops, each judged on its own file:
 *
 * 1. a **consumer** imports the name only from platform/index.ts (resolved
 *    from the importing file's path, not matched as text);
 * 2. **platform/index.ts** only passes it through: an unaliased export
 *    specifier in an `export { … } from './authz/index'` — never a
 *    declaration of its own under that name;
 * 3. **authz/index.ts** declares it exactly once, as an exported function.
 *
 * A counterfeit anywhere on the chain — a local `function scopedWhere` in
 * platform/index.ts, a consumer importing from a helper module, a second
 * declaration in authz — breaks the hop it lives on, whatever it is named
 * elsewhere.
 */
export function scopedWhereImportsOf(source: string, fromFile: string): string[] {
  const file = ts.createSourceFile(fromFile, source, ts.ScriptTarget.Latest, true);
  const origins: string[] = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const spec of bindings.elements) {
      if ((spec.propertyName ?? spec.name).text === 'scopedWhere') {
        origins.push(resolve(dirname(fromFile), statement.moduleSpecifier.text));
      }
    }
  }
  return origins;
}

/** Line numbers on which platform/index.ts does anything with the name but pass it through from authz. */
export function counterfeitsInPlatformIndex(source: string): number[] {
  const file = ts.createSourceFile('platform-index.ts', source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'scopedWhere') {
      const spec = node.parent;
      const declaration = spec.parent.parent;
      const passThrough =
        ts.isExportSpecifier(spec) &&
        spec.propertyName === undefined &&
        spec.name === node &&
        ts.isExportDeclaration(declaration) &&
        declaration.moduleSpecifier !== undefined &&
        ts.isStringLiteral(declaration.moduleSpecifier) &&
        declaration.moduleSpecifier.text === './authz/index';
      if (!passThrough)
        lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      node.text === 'scopedWhere'
    ) {
      lines.push(file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...new Set(lines)].sort((a, b) => a - b);
}

/** The exported top-level function declarations named `scopedWhere` in authz/index.ts — there must be exactly one. */
export function scopedWhereDeclarationsIn(source: string): number[] {
  const file = ts.createSourceFile('authz.ts', source, ts.ScriptTarget.Latest, true);
  const lines: number[] = [];
  for (const statement of file.statements) {
    const declared =
      (ts.isFunctionDeclaration(statement) && statement.name?.text === 'scopedWhere') ||
      (ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (d) => ts.isIdentifier(d.name) && d.name.text === 'scopedWhere',
        )) ||
      (ts.isClassDeclaration(statement) && statement.name?.text === 'scopedWhere');
    if (declared) lines.push(file.getLineAndCharacterOfPosition(statement.getStart(file)).line + 1);
  }
  return lines;
}

/** Where the snippet fixtures pretend to live, so `../platform/index` resolves. */
const HERE = join(MODULES_DIR, 'orders', 'repo.ts');

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
      for (const line of misusesScopedWhere(readFileSync(file, 'utf8'), file)) {
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
        HERE,
      ),
    ).toEqual([]);
    expect(
      misusesScopedWhere(
        repo(`    where: scopedWhere(principal, {\n      storeId,\n    }),`),
        HERE,
      ),
    ).toEqual([]);
    expect(
      misusesScopedWhere(repo(`    where:\n      scopedWhere(principal, {}, 'id'),`), HERE),
    ).toEqual([]);
    expect(
      misusesScopedWhere(repo(`    'where': scopedWhere(principal, { storeId }),`), HERE),
    ).toEqual([]);
    // A nested relation filter is still a where.
    expect(
      misusesScopedWhere(
        repo(`    select: { order: { where: scopedWhere(principal, { storeId }) } },`),
        HERE,
      ),
    ).toEqual([]);
    // The import line is not a use.
    expect(misusesScopedWhere(`import { scopedWhere } from '../platform/index';`, HERE)).toEqual(
      [],
    );
  });

  it('rejects every other use of the name — by node shape, not text', () => {
    // Spreading the helper reopens the overwrite one level up.
    expect(
      misusesScopedWhere(
        repo(`    where: { ...scopedWhere(principal, { storeId }), AND: [other] },`),
        HERE,
      ),
    ).toEqual([4]);

    // OSCAR's round-3 trick: park the result in a variable, then spread that
    // beside a second AND. The assignment is the violation — before the AND
    // key is ever written.
    const parked =
      `import { scopedWhere } from '../platform/index';\n` +
      `const scope = scopedWhere(principal, { storeId });\n` +
      `const q = { where: { ...scope, AND: [{ storeId }] } };`;
    expect(misusesScopedWhere(parked, HERE)).toEqual([2]);

    // OSCAR's round-4 trick: the initializer still *starts* with the call, but
    // is a property/element access on it — `.AND[1]` selects the caller's own
    // branch and silently drops the principal scope. Typechecks, compiles.
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId }).AND[1],`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId }).AND,`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId })['AND'][1],`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId })!.AND[1],`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId }) as never,`), HERE),
    ).toEqual([4]);

    // Any other wrapping of the call is the same shape of violation.
    expect(
      misusesScopedWhere(repo(`    where: (scopedWhere(principal, { storeId })),`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: await scopedWhere(principal, { storeId }),`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: widen(scopedWhere(principal, { storeId })),`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: cond ? scopedWhere(principal, { storeId }) : {},`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId }) ?? {},`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: scopedWhere(principal, { storeId })(),`), HERE),
    ).toEqual([4]);

    // Right call, wrong property.
    expect(
      misusesScopedWhere(repo(`    orderBy: scopedWhere(principal, { storeId }),`), HERE),
    ).toEqual([4]);
    expect(
      misusesScopedWhere(repo(`    where: { order: scopedWhere(principal, { storeId }) },`), HERE),
    ).toEqual([4]);

    // Returned from a helper, forwarded, aliased, or passed as a value.
    expect(misusesScopedWhere(`function scope(p) { return scopedWhere(p, extra); }`, HERE)).toEqual(
      [1],
    );
    expect(misusesScopedWhere(`run(principal, scopedWhere(principal, extra));`, HERE)).toEqual([1]);
    expect(misusesScopedWhere(`const f = scopedWhere;`, HERE)).toEqual([1]);
    expect(misusesScopedWhere(`const q = { scopedWhere };`, HERE)).toEqual([1]);
    expect(misusesScopedWhere(`const q = { where: scopedWhere };`, HERE)).toEqual([1]);
    expect(misusesScopedWhere(repo(`    where: widen(scopedWhere),`), HERE)).toEqual([4]);
  });

  it('a repo function handed a principal reads only through scoped(), where: scopedWhere(…) itself — OSCAR rounds 8–9', () => {
    // Every rule so far keys on `scopedWhere` being *present* and used right.
    // A read that simply omits it — `where: { storeId }`, no scope anywhere —
    // is invisible to them. Two things close that: the type system (a
    // `scoped(delegate)` read takes only a `ScopedWhere`, so a raw where does
    // not compile) and this rule, which holds that a repository function
    // taking a `Principal` makes no read except through `scoped(...)`.
    const violations: string[] = [];
    for (const file of moduleFiles(MODULES_DIR).filter((f) => f.endsWith('/repo.ts'))) {
      for (const line of unscopedReadsForPrincipal(readFileSync(file, 'utf8'), file)) {
        violations.push(`${relative(process.cwd(), file)}:${line}`);
      }
    }
    expect(violations).toEqual([]);

    const fn = (body: string): string =>
      `import { scoped, scopedWhere, type Principal } from '../platform/index';\n` +
      `export async function count(principal: Principal, storeId: string, db?: DbExecutor) {\n` +
      `${body}\n}`;
    // OSCAR's round-8 case: the scope simply left out.
    expect(
      unscopedReadsForPrincipal(
        fn(`  return executor(db).order.groupBy({ by: ['status'], where: { storeId } });`),
        HERE,
      ),
    ).toEqual([3]);
    // The honest shape.
    expect(
      unscopedReadsForPrincipal(
        fn(
          `  return scoped(executor(db).order).groupBy({ by: ['status'], where: scopedWhere(principal, { storeId }) });`,
        ),
        HERE,
      ),
    ).toEqual([]);
    // Scoped delegate, but the where forgotten (tsc refuses this too).
    expect(
      unscopedReadsForPrincipal(
        fn(`  return scoped(executor(db).order).findMany({ take: 5 });`),
        HERE,
      ),
    ).toEqual([3]);
    // Every read method, on a transaction or the client, not only executor(db).
    for (const m of ['findMany', 'findFirst', 'count', 'groupBy', 'aggregate']) {
      expect(
        unscopedReadsForPrincipal(fn(`  return prisma.order.${m}({ where: { storeId } });`), HERE),
      ).toEqual([3]);
      expect(
        unscopedReadsForPrincipal(
          fn(`  return tx.order.${m}({ where: scopedWhere(principal, { storeId }) });`),
          HERE,
        ),
      ).toEqual([3]);
    }
    // OSCAR round 9: `as never` is assignable to anything, so the brand alone
    // cannot stop a deliberate cast. The where must BE the scopedWhere call.
    expect(
      unscopedReadsForPrincipal(
        fn(
          `  return scoped(executor(db).order).groupBy({ by: ['status'], where: { storeId } as never });`,
        ),
        HERE,
      ),
    ).toEqual([3]);
    expect(
      unscopedReadsForPrincipal(
        fn(`  return scoped(executor(db).order).findMany({ where: { storeId } as any });`),
        HERE,
      ),
    ).toEqual([3]);
    expect(
      unscopedReadsForPrincipal(
        fn(
          `  return scoped(executor(db).order).findMany({ where: scopedWhere(principal, { storeId }) as never });`,
        ),
        HERE,
      ),
    ).toEqual([3]);
    expect(
      unscopedReadsForPrincipal(
        fn(
          `  const w = scopedWhere(principal, { storeId });\n  return scoped(executor(db).order).findMany({ where: w });`,
        ),
        HERE,
      ),
    ).toEqual([4]);
    expect(
      unscopedReadsForPrincipal(
        fn(
          `  return scoped(executor(db).order).findMany({ where: (scopedWhere(principal, { storeId })) });`,
        ),
        HERE,
      ),
    ).toEqual([3]);
    // Arrow functions, function expressions and methods that take a principal
    // are judged the same way as declarations.
    const arrow =
      `import { scoped, scopedWhere, type Principal } from '../platform/index';\n` +
      `export const count = async (principal: Principal, storeId: string) =>\n` +
      `  scoped(executor(db).order).count({ where: { storeId } as never });`;
    expect(unscopedReadsForPrincipal(arrow, HERE)).toEqual([3]);
    const expression =
      `export const list = async function (principal: Principal) {\n` +
      `  return executor(db).order.findMany({ where: { storeId: 'x' } });\n};`;
    expect(unscopedReadsForPrincipal(expression, HERE)).toEqual([2]);
    const method =
      `export const repo = {\n` +
      `  async list(principal: Principal) {\n` +
      `    return scoped(executor(db).order).findMany({ where: { storeId: 'x' } as never });\n` +
      `  },\n};`;
    expect(unscopedReadsForPrincipal(method, HERE)).toEqual([3]);
    const honestArrow =
      `import { scoped, scopedWhere, type Principal } from '../platform/index';\n` +
      `export const count = async (principal: Principal, storeId: string) =>\n` +
      `  scoped(executor(db).order).count({ where: scopedWhere(principal, { storeId }) });`;
    expect(unscopedReadsForPrincipal(honestArrow, HERE)).toEqual([]);
    // A nested arrow inside a principal-taking function reads on its behalf.
    expect(
      unscopedReadsForPrincipal(
        fn(
          `  const read = () => executor(db).order.findMany({ where: { storeId } });\n  return read();`,
        ),
        HERE,
      ),
    ).toEqual([3]);

    // A read in a helper the principal-taking function calls is that helper's
    // business; a function without a principal (a read by id) is not covered.
    expect(
      unscopedReadsForPrincipal(
        `export async function findZone(id: string, db?: DbExecutor) {\n  return executor(db).deliveryZone.findUnique({ where: { id } });\n}`,
        HERE,
      ),
    ).toEqual([]);
    // Two reads in one function: each judged.
    expect(
      unscopedReadsForPrincipal(
        fn(
          `  const a = await scoped(executor(db).order).findMany({ where: scopedWhere(principal, {}) });\n` +
            `  const b = await executor(db).order.count({ where: { storeId } });\n  return [a, b];`,
        ),
        HERE,
      ),
    ).toEqual([4]);
  });

  it('the brand and the scoped delegate are named nowhere outside platform', () => {
    // `as ScopedWhere<…>` in a repository would forge the brand; nothing
    // outside platform has a reason to name either type.
    const violations: string[] = [];
    for (const file of files.filter((f) => !f.includes(`${sep}platform${sep}`))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/\b(ScopedWhere|ScopedReads|ScopedBrand)\b/.test(line)) {
            violations.push(`${relative(process.cwd(), file)}:${i + 1}`);
          }
        });
    }
    expect(violations).toEqual([]);
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

    // The `ScopedWhere` type may spell the result's shape; another type may not.
    expect(
      misplacesStoreScopeFilter(
        `function storeScopeFilter(p) { return {}; }\nexport type ScopedWhere<T> = { AND: [ReturnType<typeof storeScopeFilter>, T] };`,
      ),
    ).toEqual([]);
    expect(
      misplacesStoreScopeFilter(
        `function storeScopeFilter(p) { return {}; }\nexport type Scope = ReturnType<typeof storeScopeFilter>;`,
      ),
    ).toEqual([2]);

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

  it('scopedWhere reaches a consumer only along one chain: authz defines, platform passes through, consumers import from platform — OSCAR round 10', () => {
    // Hop 3: authz/index.ts declares it exactly once, as an exported function.
    const authz = readFileSync(DEFINED_IN, 'utf8');
    expect(scopedWhereDeclarationsIn(authz)).toHaveLength(1);
    expect(misexportsScopedWhere(authz)).toEqual([]);
    // Hop 2: platform/index.ts only passes it through from authz.
    expect(counterfeitsInPlatformIndex(readFileSync(PLATFORM_INDEX, 'utf8'))).toEqual([]);
    // Hop 1: every consumer that imports it, imports it from platform/index.ts.
    const violations: string[] = [];
    for (const file of files) {
      for (const origin of scopedWhereImportsOf(readFileSync(file, 'utf8'), file)) {
        if (origin !== PLATFORM_INDEX.replace(/\.ts$/, '')) {
          violations.push(`${relative(process.cwd(), file)} <- ${relative(process.cwd(), origin)}`);
        }
      }
    }
    expect(violations).toEqual([]);

    // OSCAR's round-10 counterfeit: the re-export removed and a local
    // function of the same name installed in platform/index.ts.
    const counterfeit =
      `import { type Principal } from './authz/index';\n` +
      `export function scopedWhere<T>(principal: Principal, extra: T) {\n` +
      `  return extra as never;\n` +
      `}`;
    expect(counterfeitsInPlatformIndex(counterfeit)).toEqual([2]);
    // Other shapes of the same thing.
    expect(counterfeitsInPlatformIndex(`export const scopedWhere = (p, x) => x;`)).toEqual([1]);
    expect(counterfeitsInPlatformIndex(`export { scopedWhere } from './scope-helper';`)).toEqual([
      1,
    ]);
    expect(
      counterfeitsInPlatformIndex(`export { safe as scopedWhere } from './authz/index';`),
    ).toEqual([1]);
    expect(
      counterfeitsInPlatformIndex(
        `import { scopedWhere } from './authz/index';\nexport { scopedWhere };`,
      ),
    ).toEqual([1, 2]);
    expect(
      counterfeitsInPlatformIndex(
        `export * as authz from './authz/index';\nexport const scopedWhere = authz['scopedWhere'];`,
      ),
    ).toEqual([2]);
    // The honest pass-through.
    expect(
      counterfeitsInPlatformIndex(
        `export { authorize, scopedWhere, type ScopedWhere } from './authz/index';`,
      ),
    ).toEqual([]);

    // A second definition in authz, or a const one, is not "exactly one function".
    expect(
      scopedWhereDeclarationsIn(
        `export function scopedWhere(p, x) { return {}; }\nexport const scopedWhere2 = 1;`,
      ),
    ).toEqual([1]);
    expect(
      scopedWhereDeclarationsIn(
        `export function scopedWhere(p, x) { return {}; }\nfunction scopedWhere(p, x) { return x; }`,
      ),
    ).toEqual([1, 2]);
    expect(scopedWhereDeclarationsIn(`export const scopedWhere = (p, x) => x;`)).toEqual([1]);

    // A consumer importing it from anywhere but platform/index.ts.
    const here = join(MODULES_DIR, 'orders', 'repo.ts');
    expect(scopedWhereImportsOf(`import { scopedWhere } from '../platform/index';`, here)).toEqual([
      join(MODULES_DIR, 'platform', 'index'),
    ]);
    expect(scopedWhereImportsOf(`import { scopedWhere } from './scope';`, here)).toEqual([
      join(MODULES_DIR, 'orders', 'scope'),
    ]);
    expect(
      scopedWhereImportsOf(`import { scopedWhere as sw } from '../platform/authz/index';`, here),
    ).toEqual([join(MODULES_DIR, 'platform', 'authz', 'index')]);
  });

  it('a call site is judged by what its name resolves to, never by its spelling — OSCAR round 11', () => {
    // A helper exporting `safeScope`, imported as `scopedWhere`. Every call
    // site reads `scopedWhere(...)`; none of them is the genuine function.
    const aliasedHelper =
      `import { scoped, type Principal } from '../platform/index';\n` +
      `import { safeScope as scopedWhere } from './scope-helper';\n` +
      `export async function count(principal: Principal, storeId: string, db?: DbExecutor) {\n` +
      `  return scoped(executor(db).order).groupBy({ by: ['status'], where: scopedWhere(principal, { storeId }) });\n` +
      `}`;
    // Rule 2: the name is a counterfeit at its import and at its use.
    expect(misusesScopedWhere(aliasedHelper, HERE)).toEqual([2, 4]);
    // Rule 5: the read's where is not the genuine scopedWhere.
    expect(unscopedReadsForPrincipal(aliasedHelper, HERE)).toEqual([4]);

    // The genuine import under the genuine name from the genuine module.
    const genuine = aliasedHelper.replace(
      `import { safeScope as scopedWhere } from './scope-helper';`,
      `import { scopedWhere } from '../platform/index';`,
    );
    expect(misusesScopedWhere(genuine, HERE)).toEqual([]);
    expect(unscopedReadsForPrincipal(genuine, HERE)).toEqual([]);

    // Same remote name, wrong module: still a counterfeit.
    const wrongModule = aliasedHelper.replace(
      `import { safeScope as scopedWhere } from './scope-helper';`,
      `import { scopedWhere } from './scope-helper';`,
    );
    expect(misusesScopedWhere(wrongModule, HERE)).toEqual([2, 4]);
    expect(unscopedReadsForPrincipal(wrongModule, HERE)).toEqual([4]);
    // Right module, imported under an alias: the alias is judged as the
    // genuine function (rule 5 accepts it), the alias itself is reported (round 5).
    const aliasOfGenuine = aliasedHelper
      .replace(
        `import { safeScope as scopedWhere } from './scope-helper';`,
        `import { scopedWhere as sw } from '../platform/index';`,
      )
      .replace('where: scopedWhere(', 'where: sw(');
    expect(misusesScopedWhere(aliasOfGenuine, HERE)).toEqual([2]);
    expect(unscopedReadsForPrincipal(aliasOfGenuine, HERE)).toEqual([]);
    // A local declaration under the name, with no import at all.
    const local =
      `export function scopedWhere(p, x) { return x as never; }\n` +
      `export async function list(principal: Principal) {\n` +
      `  return scoped(executor(db).order).findMany({ where: scopedWhere(principal, {}) });\n}`;
    expect(misusesScopedWhere(local, HERE)).toEqual([1, 3]);
    expect(unscopedReadsForPrincipal(local, HERE)).toEqual([3]);
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
    expect(misusesScopedWhere(consumerHalf, HERE)).toEqual([]);

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
    expect(misusesScopedWhere(aliased, HERE)).toEqual([1, 6]);

    // The same binding, reached other ways: a namespace import, a string key,
    // a default-style re-export, a dynamic import destructure.
    expect(
      misusesScopedWhere(
        `import * as authz from '../platform/index';\nconst q = { where: authz.scopedWhere(p, x) };`,
        HERE,
      ),
    ).toEqual([2]);
    expect(
      misusesScopedWhere(
        `import * as authz from '../platform/index';\nconst q = { where: authz['scopedWhere'](p, x).AND[1] };`,
        HERE,
      ),
    ).toEqual([2]);
    expect(
      misusesScopedWhere(`const { scopedWhere: sw } = await import('../platform/index');`, HERE),
    ).toEqual([1]);
    expect(
      misusesScopedWhere(`export { scopedWhere as sw } from '../platform/index';`, HERE),
    ).toEqual([1]);
    expect(
      misusesScopedWhere(
        `import * as authz from '../platform/index';\nconst q = { where: authz.scopedWhere(p, x).AND[1] };`,
        HERE,
      ),
    ).toEqual([2]);
  });
});
