import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * Proves the module-boundary rules actually bite (Phase 1 Definition of Done).
 *
 * Each case writes a deliberately illegal file into the real source tree, runs
 * the project's own ESLint config over it, and asserts the expected rule fires.
 * The file is written rather than committed because a committed violation would
 * either break `npm run lint` for everyone or have to be ignored — and an
 * ignored file proves nothing.
 *
 * Each case is given an explicit timeout: spinning up ESLint with the flat
 * config, the TypeScript resolver and the import plugin costs several seconds on
 * the first run, which overshot Vitest's 5s default whenever the machine was
 * also busy building. A timeout here is not slack for a slow assertion — it is
 * the honest cost of running the project's real linter.
 */
const LINT_TIMEOUT_MS = 60_000;

const projectRoot = process.cwd();
const written: string[] = [];

function lintFixture(relativePath: string, source: string): Promise<ESLint.LintResult[]> {
  const absolutePath = join(projectRoot, relativePath);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, source, 'utf8');
  written.push(absolutePath);

  const eslint = new ESLint({ cwd: projectRoot });
  return eslint.lintFiles([absolutePath]);
}

function ruleIds(results: ESLint.LintResult[]): string[] {
  return results.flatMap((result) => result.messages.map((message) => message.ruleId ?? '(fatal)'));
}

afterEach(() => {
  for (const path of written.splice(0)) {
    rmSync(path, { force: true });
  }
});

describe('module boundaries', () => {
  it(
    'rejects a cross-module deep import',
    async () => {
      const results = await lintFixture(
        'src/modules/orders/__boundary_fixture__.ts',
        [
          "import { executor } from '../inventory/repo';",
          '',
          'export const leak = executor;',
          '',
        ].join('\n'),
      );

      expect(ruleIds(results)).toContain('import/no-restricted-paths');
      const message = results[0]?.messages.find(
        (entry) => entry.ruleId === 'import/no-restricted-paths',
      );
      expect(message?.message).toContain('inventory');
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'rejects reaching into another module’s domain internals',
    async () => {
      const results = await lintFixture(
        'src/modules/cart/__boundary_fixture__.ts',
        [
          "import { descriptor } from '../pricing/domain/index';",
          '',
          'export const leak = descriptor;',
          '',
        ].join('\n'),
      );

      expect(ruleIds(results)).toContain('import/no-restricted-paths');
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'rejects app/** importing a module repo',
    async () => {
      const results = await lintFixture(
        'src/app/__boundary_fixture__/route.ts',
        [
          "import { executor } from '@/modules/inventory/repo';",
          '',
          'export const GET = () => new Response(String(typeof executor));',
          '',
        ].join('\n'),
      );

      expect(ruleIds(results)).toContain('import/no-restricted-paths');
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'rejects app/** importing the Prisma client directly',
    async () => {
      const results = await lintFixture(
        'src/app/__boundary_fixture__/prisma-route.ts',
        [
          "import { PrismaClient } from '@prisma/client';",
          '',
          'export const GET = () => new Response(String(typeof PrismaClient));',
          '',
        ].join('\n'),
      );

      expect(ruleIds(results)).toContain('no-restricted-imports');
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'rejects src/lib importing domain modules',
    async () => {
      const results = await lintFixture(
        'src/lib/__boundary_fixture__.ts',
        [
          "import { moduleDescriptor } from '@/modules/orders/index';",
          '',
          'export const leak = moduleDescriptor;',
          '',
        ].join('\n'),
      );

      expect(ruleIds(results)).toContain('import/no-restricted-paths');
    },
    LINT_TIMEOUT_MS,
  );

  it(
    'allows the legal import: another module through its index.ts',
    async () => {
      const results = await lintFixture(
        'src/modules/checkout/__boundary_fixture__.ts',
        [
          "import { moduleDescriptor } from '../orders/index';",
          "import { newId } from '../platform/index';",
          '',
          'export const legal = () => `${moduleDescriptor().name}:${newId()}`;',
          '',
        ].join('\n'),
      );

      expect(ruleIds(results)).not.toContain('import/no-restricted-paths');
      expect(results[0]?.errorCount).toBe(0);
    },
    LINT_TIMEOUT_MS,
  );
});
