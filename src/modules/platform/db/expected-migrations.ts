// GENERATED FILE — do not edit by hand.
// Regenerate with `npm run db:manifest` after adding a Prisma migration.
//
// The migration identities this build ships with. `checkDbHealth` compares them
// against `_prisma_migrations` so a database that is empty, on an older schema,
// or mid-way through a failed migration reports `pending` instead of `current`.

export const EXPECTED_MIGRATIONS: readonly string[] = [
  '20260906090000_init',
  '20260907190000_store_low_stock_threshold',
  '20260907200000_catalog_search_trgm',
  '20260907210000_inventory_import_history',
  '20260907230000_audit_log_store_scope',
  '20260908120000_customer_session',
  '20260908190000_cart_pending_notice',
  '20260909131451_order_slot_index',
  '20260911171708_totp_last_counter',
];
