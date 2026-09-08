-- A signed-in shopper's session (ADR-0010).
--
-- Additive only: no Phase 1/2 table is altered. The staff `Session` table is
-- untouched, which is the point — `Session.userId` is a non-null foreign key to
-- `User`, and Auth.js v5 has one session cookie per app, so sharing either
-- would make "is this a shopper or a member of staff?" a discriminator inside
-- one credential. Two tables and two cookies make it structural instead.
--
-- NOTE (p2-followup-gin-index-drift): `prisma migrate diff` also emitted
--   DROP INDEX "Product_brand_trgm_idx";
--   DROP INDEX "Product_name_trgm_idx";
-- because the two `pg_trgm` GIN indexes are created by raw SQL in
-- 20260907200000_catalog_search_trgm and are therefore invisible to the Prisma
-- schema. They have been removed by hand, as in every migration since. Applying
-- them would silently drop catalogue search. The permanent fix is tracked as
-- `p2-followup-gin-index-drift`.

-- CreateTable
CREATE TABLE "CustomerSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerSession_token_key" ON "CustomerSession"("token");

-- CreateIndex
CREATE INDEX "CustomerSession_customerId_idx" ON "CustomerSession"("customerId");

-- CreateIndex
CREATE INDEX "CustomerSession_expiresAt_idx" ON "CustomerSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "CustomerSession" ADD CONSTRAINT "CustomerSession_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
