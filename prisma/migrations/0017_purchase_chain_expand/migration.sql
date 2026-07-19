-- Expanded purchasing chain: voucher signing, cash release/hand-off, task
-- assignment, and delivery to the warehouseman.

-- New PurchaseRequestStatus values (safe to re-run).
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'VOUCHER_SIGNED';
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'CASH_RELEASED';
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'WITH_PURCHASER';
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'TASKED';
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';

-- Sign-off log for the new chain steps.
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "chainLog" JSONB NOT NULL DEFAULT '{}';
