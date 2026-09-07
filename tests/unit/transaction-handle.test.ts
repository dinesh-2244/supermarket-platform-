import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { assertTransactionHandle, type DbExecutor } from '@/modules/platform';

const run = promisify(execFile);

/**
 * R3 — the transaction handle must be unforgeable.
 *
 * `Prisma.TransactionClient` is `Omit<PrismaClient, ITXClientDenyList>`, which is
 * *structurally compatible* with `PrismaClient`. Aliasing it therefore promised
 * a transaction-only contract the compiler never enforced: `selectForUpdate`
 * accepted a standalone client, ran `SELECT … FOR UPDATE` in an implicit
 * single-statement transaction, and released the row lock before the caller
 * could touch the stock it had just "locked".
 *
 * The fixtures live under `tests/fixtures/`, which `tsconfig.json` excludes, so
 * a file that must *not* compile cannot break `npm run typecheck`. They are
 * compiled here on purpose, with the project's own strict options.
 */
async function typecheckFixtures(): Promise<{ ok: boolean; output: string }> {
  try {
    await run('npx', ['tsc', '--noEmit', '-p', 'tests/fixtures/tsconfig.fixture.json'], {
      cwd: process.cwd(),
    });
    return { ok: true, output: '' };
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

describe('transaction handle — compile-time rejection', () => {
  it('rejects the root Prisma client wherever a transaction is required', async () => {
    const result = await typecheckFixtures();

    expect(result.ok).toBe(false);

    const errorLines = result.output
      .split('\n')
      .filter((line) => line.includes('tx-handle-rejected.fixture.ts'));

    // One error per illegal call: lock, multi-lock, audited write.
    const reportedLines = new Set(errorLines.map((line) => line.split('(')[1]?.split(',')[0]));
    expect(reportedLines.size).toBe(3);
    expect(result.output).toContain('is not assignable to parameter of type');

    // …and the legal path — a handle minted by withTransaction — still compiles.
    expect(result.output).not.toContain('tx-handle-accepted.fixture.ts');
  }, 120_000);

  it('keeps the fixtures pointed at the real API', () => {
    const rejected = readFileSync('tests/fixtures/tx-handle-rejected.fixture.ts', 'utf8');
    expect(rejected).toContain('selectForUpdate(getPrisma()');
    expect(rejected).toContain('auditedExecutor(getPrisma())');
  });
});

describe('transaction handle — runtime rejection', () => {
  // Defence in depth for anyone who reaches for `as unknown as Tx`: Prisma's
  // interactive-transaction proxy omits $transaction/$connect, so their presence
  // identifies the singleton client.
  const rootClientShape = {
    $transaction: () => Promise.resolve(),
    $connect: () => Promise.resolve(),
    $queryRaw: () => Promise.resolve([]),
  } as unknown as DbExecutor;

  const txShape = { $queryRaw: () => Promise.resolve([]) } as unknown as DbExecutor;

  it('throws when handed the root client', () => {
    expect(() => {
      assertTransactionHandle(rootClientShape);
    }).toThrow(/transaction handle/i);
  });

  it('accepts a transaction-shaped handle', () => {
    expect(() => {
      assertTransactionHandle(txShape);
    }).not.toThrow();
  });
});
