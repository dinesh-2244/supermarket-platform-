-- Immutable store scope on AuditLog (R3).
--
-- NOTE: `prisma migrate diff` again proposed DROP INDEX for
-- "Product_name_trgm_idx" and "Product_brand_trgm_idx" — the GIN trigram indexes
-- created in raw SQL by 20260907200000_catalog_search_trgm, which Prisma has no
-- record of in schema.prisma. Removed by hand, as in
-- 20260907210000_inventory_import_history. Check for this in EVERY new migration
-- until the drift is fixed properly.

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "storeId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_storeId_createdAt_idx" ON "AuditLog"("storeId", "createdAt");

