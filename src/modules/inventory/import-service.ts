/**
 * Stock import (D6). Validate **every** row before applying **any**, then apply
 * the whole file in one transaction.
 *
 * The rule is not fussiness. A part-applied import leaves the operator with no
 * way to know which rows landed — re-running it double-counts every `delta` row
 * that already applied, and skipping it leaves the rest unwritten. Refusing the
 * whole file with a per-row report is the only outcome they can act on.
 */
import {
  assertAuthorized,
  NotFoundError,
  ValidationError,
  withTransaction,
  writeAuditLog,
  type Principal,
} from '../platform/index';
import {
  MAX_IMPORT_ROWS,
  parseStockCsv,
  type ImportMode,
  type ParsedRow,
  type RowError,
} from './domain/csv';
import { announceMovement, applyMovement, type MovementResult } from './service';
import * as repo from './repo';
import { findProductIdsBySku } from '../catalog/index';

export type { ImportMode, RowError } from './domain/csv';
export { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, IMPORT_MODES } from './domain/csv';

/** What one row would do, resolved against the store's real stock. */
export interface PlannedChange {
  readonly line: number;
  readonly sku: string;
  readonly productId: string;
  readonly mode: ImportMode;
  readonly quantity: number;
  readonly currentStock: number;
  readonly newStock: number;
  readonly delta: number;
}

export interface ImportPlan {
  readonly storeId: string;
  readonly filename: string;
  readonly mode: ImportMode;
  readonly rowCount: number;
  readonly changes: readonly PlannedChange[];
  /** Rows that would change nothing — reported, not applied. */
  readonly unchanged: readonly PlannedChange[];
  readonly errors: readonly RowError[];
  readonly ok: boolean;
}

export interface ImportInput {
  readonly storeId: string;
  readonly filename: string;
  readonly content: string;
  readonly mode?: ImportMode;
  readonly byteLength?: number;
}

/**
 * Parse and validate, touching nothing.
 *
 * Every row is checked against the database — the SKU must be a real product,
 * *and* that product must be listed by this store, so one store's file cannot
 * silently create stock rows in another's catalogue. Rows that would drive stock
 * negative are errors here rather than surprises during the apply.
 */
export async function planStockImport(
  principal: Principal,
  input: ImportInput,
): Promise<ImportPlan> {
  assertAuthorized(principal, 'inventory:import', {
    type: 'InventoryItem',
    storeId: input.storeId,
  });

  const mode = input.mode ?? 'set';
  const parsed = parseStockCsv(input.content, mode, input.byteLength);
  const errors: RowError[] = [...parsed.errors];

  const skus = parsed.rows.map((row) => row.sku);
  const productIdBySku = await findProductIdsBySku(principal, skus);
  const listed = await repo.findListedProductIds(input.storeId, [...productIdBySku.values()]);

  const resolvable = parsed.rows.filter((row) => {
    const productId = productIdBySku.get(row.sku);
    if (productId === undefined) {
      errors.push({ line: row.line, sku: row.sku, message: 'No product with that SKU' });
      return false;
    }
    if (!listed.has(productId)) {
      errors.push({
        line: row.line,
        sku: row.sku,
        message: 'That product is not set up for this store',
      });
      return false;
    }
    return true;
  });

  const productIds = resolvable
    .map((row) => productIdBySku.get(row.sku))
    .filter((id): id is string => id !== undefined);
  const items = await repo.listItems(principal, {
    storeId: input.storeId,
    productIds,
    limit: MAX_IMPORT_ROWS,
  });
  const stockByProduct = new Map(items.map((item) => [item.productId, item.websiteStock]));

  const changes: PlannedChange[] = [];
  const unchanged: PlannedChange[] = [];

  for (const row of resolvable) {
    const productId = productIdBySku.get(row.sku)!;
    const currentStock = stockByProduct.get(productId) ?? 0;
    const newStock = row.mode === 'set' ? row.quantity : currentStock + row.quantity;

    if (newStock < 0) {
      errors.push({
        line: row.line,
        sku: row.sku,
        message: `That would take stock to ${String(newStock)} — it cannot go below zero`,
      });
      continue;
    }

    const planned: PlannedChange = {
      line: row.line,
      sku: row.sku,
      productId,
      mode: row.mode,
      quantity: row.quantity,
      currentStock,
      newStock,
      delta: newStock - currentStock,
    };
    if (planned.delta === 0) unchanged.push(planned);
    else changes.push(planned);
  }

  return {
    storeId: input.storeId,
    filename: input.filename,
    mode,
    rowCount: parsed.rows.length + parsed.errors.length,
    changes,
    unchanged,
    errors,
    ok: errors.length === 0,
  };
}

export interface ImportOutcome extends ImportPlan {
  /** `null` for a dry run — a preview creates no history row. */
  readonly importId: string | null;
  readonly outcome: 'dry-run' | 'applied' | 'rejected';
  readonly applied: number;
}

/**
 * Validate, then apply every change in **one** transaction.
 *
 * A single bad row rejects the whole file — nothing is written, and the run is
 * still recorded with its errors so the operator can download the report and fix
 * the file. `dryRun` stops after the plan.
 *
 * Re-running the same file: `set` is idempotent (the second run plans zero
 * changes); `delta` is **not** — it applies again. That is inherent to what the
 * two modes mean, and the import history is how you tell whether a file already
 * ran.
 */
export async function runStockImport(
  principal: Principal,
  input: ImportInput & { dryRun?: boolean },
): Promise<ImportOutcome> {
  const plan = await planStockImport(principal, input);
  const dryRun = input.dryRun ?? false;
  const actorUserId = principal.kind === 'user' ? principal.userId : null;

  // A dry run writes *nothing* — the UI says so, so the history must not gain a
  // row either. Only a real attempt (applied or rejected) is recorded.
  if (dryRun) {
    return { ...plan, importId: null, outcome: 'dry-run', applied: 0 };
  }

  if (!plan.ok) {
    const record = await repo.insertImportRun({
      storeId: plan.storeId,
      filename: plan.filename,
      mode: plan.mode,
      outcome: 'rejected',
      rowCount: plan.rowCount,
      appliedCount: 0,
      errorCount: plan.errors.length,
      errors: plan.errors,
      actorUserId,
    });
    return { ...plan, importId: record.id, outcome: 'rejected', applied: 0 };
  }

  const results: MovementResult[] = [];
  const applied: PlannedChange[] = [];
  // Rows the *locked* balances said would change nothing. Rebuilt here rather
  // than filtered out of the pre-transaction plan: after a concurrent adjust the
  // plan's numbers are stale, so a row that ended up unchanged was still being
  // reported as "100 → 110 (+10)" when the truth was "110 → 110 (0)".
  const settled: PlannedChange[] = [];

  const outcome = await withTransaction(async (tx) => {
    // The import run is created first so its id can be the ledger reference: a
    // filename is reusable, so "which run moved this stock?" was unanswerable
    // when the same file was imported twice.
    const run = await repo.insertImportRun(
      {
        storeId: plan.storeId,
        filename: plan.filename,
        mode: plan.mode,
        outcome: 'applied',
        rowCount: plan.rowCount,
        appliedCount: 0,
        errorCount: 0,
        errors: [],
        actorUserId,
      },
      tx,
    );

    // Lock EVERY affected row, in a deterministic order, before deciding
    // anything — including rows the plan thought were unchanged.
    //
    // The plan's deltas were computed from balances read outside this
    // transaction. A concurrent adjust between the plan and the apply made a
    // `set 110` add its stale delta of +10 to a balance that had already moved:
    // the row ended at 120 while the import reported 110. Set-mode differences
    // have to come from the balance this transaction is holding.
    const candidates = [...plan.changes, ...plan.unchanged].sort((a, b) =>
      a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0,
    );

    const locked = new Map<string, number>();
    for (const change of candidates) {
      await repo.ensureItem(tx, plan.storeId, change.productId);
      const row = await repo.lockItem(tx, plan.storeId, change.productId);
      if (row === null) {
        throw new NotFoundError('No inventory row for that store and product', {
          storeId: plan.storeId,
          productId: change.productId,
        });
      }
      locked.set(change.productId, row.websiteStock);
    }

    // Revalidate the whole batch against the locked balances, then apply.
    const recomputed: { change: PlannedChange; delta: number }[] = [];
    for (const change of candidates) {
      const current = locked.get(change.productId) ?? 0;
      const target = change.mode === 'set' ? change.quantity : current + change.quantity;

      if (target < 0) {
        throw new ValidationError(
          `Line ${String(change.line)} (${change.sku}) would take stock to ${String(target)} — it cannot go below zero`,
          { line: change.line, sku: change.sku, current, target },
        );
      }
      const delta = target - current;
      if (delta !== 0) recomputed.push({ change, delta });
      else settled.push({ ...change, currentStock: current, newStock: current, delta: 0 });
    }

    for (const { change, delta } of recomputed) {
      const before = locked.get(change.productId) ?? 0;
      const movement = await applyMovement(tx, principal, {
        storeId: plan.storeId,
        productId: change.productId,
        delta,
        reason: 'CSV_IMPORT',
        refType: 'import',
        refId: run.id,
        note: `${change.mode} ${String(change.quantity)} (line ${String(change.line)}, ${plan.filename})`,
      });
      results.push(movement);
      applied.push({ ...change, currentStock: before, newStock: movement.balanceAfter, delta });

      // Per-item before/after, so this sensitive stock path shows the same
      // detail in the generic trail that a manual adjustment does. A batch
      // summary alone could not answer "what did this do to that product?".
      await writeAuditLog(tx, {
        principal,
        action: 'import',
        entityType: 'InventoryItem',
        entityId: `${plan.storeId}:${change.productId}`,
        storeId: plan.storeId,
        before: { websiteStock: movement.balanceBefore },
        after: {
          websiteStock: movement.balanceAfter,
          delta: movement.delta,
          sku: change.sku,
          line: change.line,
          importId: run.id,
        },
      });
    }

    const finished = await repo.updateImportRunCounts(tx, run.id, recomputed.length);

    await writeAuditLog(tx, {
      principal,
      action: 'import',
      entityType: 'InventoryImport',
      entityId: run.id,
      storeId: plan.storeId,
      before: {
        stock: Object.fromEntries(candidates.map((c) => [c.sku, locked.get(c.productId) ?? 0])),
      },
      after: {
        filename: plan.filename,
        mode: plan.mode,
        applied: recomputed.length,
        unchanged: candidates.length - recomputed.length,
        stock: Object.fromEntries(
          candidates.map((c) => {
            const change = applied.find((a) => a.productId === c.productId);
            return [c.sku, change?.newStock ?? locked.get(c.productId) ?? 0];
          }),
        ),
      },
    });

    return finished;
  });

  // After commit: a handler must not be able to roll back an import that landed.
  for (const result of results) announceMovement(result);

  return {
    ...plan,
    // Both lists are built from what this transaction actually saw and did, not
    // from the pre-transaction plan.
    changes: applied,
    unchanged: settled,
    importId: outcome.id,
    outcome: 'applied',
    applied: applied.length,
  };
}

/** Who imported what, when, and how it went (D6). */
export async function listImportHistory(
  principal: Principal,
  storeId: string,
  limit = 50,
): Promise<readonly repo.ImportRunRecord[]> {
  assertAuthorized(principal, 'inventory:read', { type: 'InventoryImport', storeId });
  return repo.listImportRuns(principal, storeId, Math.min(limit, 200));
}

/** One run, for the downloadable error report. */
export async function getImportRun(
  principal: Principal,
  importId: string,
): Promise<repo.ImportRunRecord> {
  const run = await repo.findImportRun(importId);
  if (run === null) throw new NotFoundError('Import not found', { importId });
  assertAuthorized(principal, 'inventory:read', {
    type: 'InventoryImport',
    storeId: run.storeId,
  });
  return run;
}

/**
 * Neutralise a value that a spreadsheet would execute as a formula.
 *
 * The error report is downloaded and opened in Excel or Sheets — the same tool
 * the broken file came from. A cell beginning `=`, `+`, `-`, `@`, tab or CR is
 * treated as a formula there, so an attacker-controlled SKU of `=1+1` (or
 * something far worse, like a `WEBSERVICE()` call exfiltrating the sheet) runs
 * on the operator's machine. Quoting does not help: the quotes are consumed by
 * the CSV parser before the formula engine sees the value.
 *
 * A leading apostrophe is the conventional fix — the cell renders as text.
 * Control characters are dropped outright; they have no business in a report.
 */
export function neutralizeCsvValue(value: string): string {
  // Strip C0 control characters, keeping the ones a CSV legitimately uses
  // (tab, LF, CR are handled by the quoting below). Written as a code-point
  // filter rather than a regex so the intent is readable and ESLint's
  // no-control-regex rule is not being worked around.
  const cleaned = [...value]
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    })
    .join('');

  return FORMULA_PREFIXES.has(cleaned.charAt(0)) ? `'${cleaned}` : cleaned;
}

/** What a spreadsheet treats as the start of a formula. */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

/** The error report as a CSV the operator can open in the tool they exported from. */
export function errorReportCsv(errors: readonly RowError[]): string {
  const cell = (value: string): string => {
    const safe = neutralizeCsvValue(value);
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [
    'line,sku,error',
    ...errors.map((e) => [String(e.line), cell(e.sku ?? ''), cell(e.message)].join(',')),
  ].join('\n');
}

export type { ParsedRow };
