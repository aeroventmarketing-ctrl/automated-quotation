-- Inter-department stock transfer ledger for the departmental P&L. Records a
-- Fans → <dept> transfer (a Fans sale / requesting-dept purchase) when in-house
-- duct hardware (angle corner / TDC cleat / S-clip / C-clip) is issued from stock
-- via the MRF, valued at the stock item's unit (production) cost. No payment moves
-- — a transfer-pricing record the management P&L reads. Kept relation-free so a
-- later stock-item / order deletion never erases booked P&L history.

CREATE TABLE IF NOT EXISTS "DeptStockTransfer" (
  "id" TEXT NOT NULL,
  "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "quotationId" TEXT,
  "fromDept" TEXT NOT NULL DEFAULT 'fans',
  "toDept" TEXT NOT NULL,
  "stockItemId" TEXT,
  "description" TEXT NOT NULL,
  "qty" DECIMAL(14,3) NOT NULL,
  "unitCost" DECIMAL(14,2) NOT NULL,
  "value" DECIMAL(14,2) NOT NULL,
  "byName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeptStockTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeptStockTransfer_at_idx" ON "DeptStockTransfer"("at");
CREATE INDEX IF NOT EXISTS "DeptStockTransfer_quotationId_idx" ON "DeptStockTransfer"("quotationId");

-- Enable Row-Level Security on any new public table (deny-all for the Supabase
-- public API; Prisma connects as the owner and bypasses RLS). Idempotent.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
