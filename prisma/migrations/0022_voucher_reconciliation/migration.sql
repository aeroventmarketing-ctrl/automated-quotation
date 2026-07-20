-- Voucher reconciliation: actual cash spent vs the issued voucher, with receipts.
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "reconciliation" JSONB NOT NULL DEFAULT '{}';
