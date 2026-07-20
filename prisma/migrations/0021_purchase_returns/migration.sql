-- Supplier returns: disapproved items sent back to the supplier for replacement.
ALTER TABLE "PurchaseRequest" ADD COLUMN IF NOT EXISTS "returns" JSONB NOT NULL DEFAULT '[]';
