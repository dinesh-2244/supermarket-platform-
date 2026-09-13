-- CreateEnum
CREATE TYPE "ProductRequestStatus" AS ENUM ('NEW', 'REVIEWED', 'PLANNED', 'DECLINED', 'FULFILLED');

-- CreateTable
CREATE TABLE "ProductRequest" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "brand" TEXT,
    "packSize" TEXT,
    "note" TEXT,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "status" "ProductRequestStatus" NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductRequestStatusHistory" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fromStatus" "ProductRequestStatus",
    "toStatus" "ProductRequestStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductRequestStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductRequest_storeId_status_createdAt_idx" ON "ProductRequest"("storeId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProductRequestStatusHistory_requestId_createdAt_idx" ON "ProductRequestStatusHistory"("requestId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductRequest" ADD CONSTRAINT "ProductRequest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRequestStatusHistory" ADD CONSTRAINT "ProductRequestStatusHistory_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ProductRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
