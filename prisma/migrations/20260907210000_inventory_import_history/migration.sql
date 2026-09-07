-- Import history (D6).
--
-- NOTE FOR FUTURE MIGRATIONS: `prisma migrate diff` wanted to DROP
-- "Product_name_trgm_idx" and "Product_brand_trgm_idx" here. Those are the GIN
-- trigram indexes created by 20260907200000_catalog_search_trgm in raw SQL —
-- Prisma has no record of them in schema.prisma, so every diff will keep
-- proposing to remove them. They are deliberately kept; the DROP statements were
-- removed from this file by hand. Check for the same thing in the next migration.

-- CreateTable
CREATE TABLE "InventoryImport" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "appliedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorsJson" JSONB,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryImport_storeId_createdAt_idx" ON "InventoryImport"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "InventoryImport" ADD CONSTRAINT "InventoryImport_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

