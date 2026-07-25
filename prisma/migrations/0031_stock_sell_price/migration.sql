-- Per-item selling price on stock, shown alongside availability so Sales can
-- quote quickly. Idempotent; safe to run in the Supabase SQL editor.
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "sellPrice" DECIMAL(14,2) NOT NULL DEFAULT 0;
