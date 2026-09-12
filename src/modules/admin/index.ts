/**
 * `admin` — public surface. Owns: back-office read models and BFF.
 *
 * This file is the ONLY entry point `app/` may import; `service.ts`, `repo.ts`
 * and `domain/` are module-private.
 */
export {
  ACTIONABLE_ORDER_STATUSES,
  auditEntries,
  listingRows,
  moduleDescriptor,
  orderCounts,
  orderDetail,
  orderQueue,
  overview,
  resolveStoreId,
  stockRows,
  type AuditEntryRecord,
  type AuditQuery,
  type ListingRow,
  type OrderCounts,
  type OrderQueue,
  type Overview,
  type StockRow,
} from './service';

export {
  formatDateTime,
  formatDelta,
  formatPaise,
  navigationFor,
  safeNextPath,
  type ModuleDescriptor,
  type NavItem,
} from './domain/index';
