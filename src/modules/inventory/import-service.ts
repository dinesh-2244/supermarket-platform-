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
  const productIdBySku = await repo.findProductIdsBySku(skus);
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
  readonly importId: string;
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

  if (!plan.ok || dryRun) {
    const record = await repo.insertImportRun({
      storeId: plan.storeId,
      filename: plan.filename,
      mode: plan.mode,
      outcome: plan.ok ? 'dry-run' : 'rejected',
      rowCount: plan.rowCount,
      appliedCount: 0,
      errorCount: plan.errors.length,
      errors: plan.errors,
      actorUserId,
    });
    return {
      ...plan,
      importId: record.id,
      outcome: plan.ok ? 'dry-run' : 'rejected',
      applied: 0,
    };
  }

  const results: MovementResult[] = [];
  const record = await withTransaction(async (tx) => {
    for (const change of plan.changes) {
      results.push(
        await applyMovement(tx, principal, {
          storeId: plan.storeId,
          productId: change.productId,
          delta: change.delta,
          reason: 'CSV_IMPORT',
          refType: 'import',
          refId: plan.filename,
          note: `${change.mode} ${String(change.quantity)} (line ${String(change.line)})`,
        }),
      );
    }

    const run = await repo.insertImportRun(
      {
        storeId: plan.storeId,
        filename: plan.filename,
        mode: plan.mode,
        outcome: 'applied',
        rowCount: plan.rowCount,
        appliedCount: plan.changes.length,
        errorCount: 0,
        errors: [],
        actorUserId,
      },
      tx,
    );

    await writeAuditLog(tx, {
      principal,
      action: 'import',
      entityType: 'InventoryImport',
      entityId: run.id,
      after: {
        filename: plan.filename,
        mode: plan.mode,
        applied: plan.changes.length,
        unchanged: plan.unchanged.length,
      },
    });
    return run;
  });

  // After commit: a handler must not be able to roll back an import that landed.
  for (const result of results) announceMovement(result);

  return { ...plan, importId: record.id, outcome: 'applied', applied: plan.changes.length };
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

/** The error report as a CSV the operator can open in the tool they exported from. */
export function errorReportCsv(errors: readonly RowError[]): string {
  const escape = (value: string): string =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return [
    'line,sku,error',
    ...errors.map((e) => [String(e.line), escape(e.sku ?? ''), escape(e.message)].join(',')),
  ].join('\n');
}

export type { ParsedRow };
