/**
 * `inventory` — public surface. Owns: InventoryItem (`websiteStock`),
 * StockLedger, CSV import, reconcile, the POS-feed boundary.
 *
 * This file is the ONLY entry point other modules and `app/` may import;
 * `service.ts`, `repo.ts` and `domain/` are module-private.
 */
export {
  adjustStock,
  announceMovement,
  applyMovement,
  getStock,
  isLow,
  listLedger,
  listLowStock,
  listStock,
  moduleDescriptor,
  reconcileStock,
  type InventoryRecord,
  type LedgerQuery,
  type LedgerRecord,
  type MovementInput,
  type MovementResult,
} from './service';

export {
  ADMIN_REASONS,
  assertQuantity,
  crossedLowThresholdDownward,
  nextBalance,
  reconcileDelta,
  STOCK_REASONS,
  type ModuleDescriptor,
  type StockReason,
} from './domain/index';

export {
  errorReportCsv,
  getImportRun,
  IMPORT_MODES,
  listImportHistory,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  planStockImport,
  runStockImport,
  type ImportInput,
  type ImportMode,
  type ImportOutcome,
  type ImportPlan,
  type PlannedChange,
  type RowError,
} from './import-service';

export { parseStockCsv, type ParsedRow, type ParseResult } from './domain/csv';
