-- Office stock-transfer chain (Fans → Office resale stock): a 5-step approval flow
-- (purchaser requests → Plant Manager approves → Warehouse releases & deducts →
-- Logistics delivers → Sales/Office receives & credits). Adds the new statuses and
-- the per-step stamp columns. The existing 2-party transfer flow is unchanged.

ALTER TYPE "StockTransferStatus" ADD VALUE IF NOT EXISTS 'REQUESTED';
ALTER TYPE "StockTransferStatus" ADD VALUE IF NOT EXISTS 'APPROVED';
ALTER TYPE "StockTransferStatus" ADD VALUE IF NOT EXISTS 'RELEASED';
ALTER TYPE "StockTransferStatus" ADD VALUE IF NOT EXISTS 'DELIVERING';

ALTER TABLE "StockTransfer"
  ADD COLUMN IF NOT EXISTS "approvedById"    TEXT,
  ADD COLUMN IF NOT EXISTS "approvedByName"  TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "releasedById"    TEXT,
  ADD COLUMN IF NOT EXISTS "releasedByName"  TEXT,
  ADD COLUMN IF NOT EXISTS "releasedAt"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deliveredById"   TEXT,
  ADD COLUMN IF NOT EXISTS "deliveredByName" TEXT,
  ADD COLUMN IF NOT EXISTS "deliveredAt"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "receivedById"    TEXT,
  ADD COLUMN IF NOT EXISTS "receivedByName"  TEXT;

-- Enable Row-Level Security on any new public table (no-op here — no new table —
-- but kept per the migration convention; idempotent).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
