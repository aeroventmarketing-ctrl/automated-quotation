-- CreateEnum
CREATE TYPE "PurchaseRequestStatus" AS ENUM ('PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'VOUCHER_READY', 'PURCHASED', 'CHECKED', 'RECEIVED', 'COMPLETED');

-- CreateTable
CREATE TABLE "PurchaseRequest" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "mrfId" TEXT,
    "dept" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "status" "PurchaseRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "createdById" TEXT NOT NULL,
    "createdByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "voucherRef" TEXT,
    "voucherByName" TEXT,
    "voucherAt" TIMESTAMP(3),
    "purchasedByName" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "checkedByName" TEXT,
    "checkedAt" TIMESTAMP(3),
    "receivedByName" TEXT,
    "receivedAt" TIMESTAMP(3),
    "plantApprovedByName" TEXT,
    "plantApprovedAt" TIMESTAMP(3),

    CONSTRAINT "PurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseRequest_quotationId_idx" ON "PurchaseRequest"("quotationId");

-- CreateIndex
CREATE INDEX "PurchaseRequest_status_idx" ON "PurchaseRequest"("status");

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

