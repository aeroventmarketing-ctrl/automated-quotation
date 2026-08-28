-- The catalogue price owner (Admin / Payment Approver) confirms a catalogue
-- change before it applies.
--
-- Two halves of the same rule:
--   1. StockAction gains a third sign-off slot, used by EDIT only — an Inventory
--      "Propose edit" carries the unit cost and selling price, so the Warehouse +
--      Purchaser handshake alone must no longer apply it.
--   2. ProductChange parks a product add / save / delete proposed by anyone who
--      is not the price owner, until they confirm it.

-- 1) StockAction: the price owner's slot.
ALTER TABLE "StockAction" ADD COLUMN IF NOT EXISTS "approverByName" TEXT;
ALTER TABLE "StockAction" ADD COLUMN IF NOT EXISTS "approverAt" TIMESTAMP(3);

-- Stock actions already pending when this shipped were proposed under the old
-- two-party rule; holding them for a sign-off nobody knew about would strand
-- them. Only EDIT is affected, and only those already carrying both approvals.
UPDATE "StockAction"
   SET "approverByName" = 'Pre-existing (two-party rule)', "approverAt" = "purchaserAt"
 WHERE "kind" = 'EDIT' AND "status" = 'PENDING'
   AND "warehouseAt" IS NOT NULL AND "purchaserAt" IS NOT NULL AND "approverAt" IS NULL;

-- 2) ProductChange.
DO $$ BEGIN
  CREATE TYPE "ProductChangeKind" AS ENUM ('CREATE', 'UPDATE', 'DELETE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "ProductChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "ProductChange" (
  "id" TEXT NOT NULL,
  "productId" TEXT,
  "productName" TEXT NOT NULL,
  "kind" "ProductChangeKind" NOT NULL,
  "payload" JSONB NOT NULL,
  "before" JSONB,
  "summary" TEXT NOT NULL,
  "status" "ProductChangeStatus" NOT NULL DEFAULT 'PENDING',
  "proposedById" TEXT NOT NULL,
  "proposedByName" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedByName" TEXT,
  "decidedAt" TIMESTAMP(3),
  "rejectReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProductChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ProductChange_status_idx" ON "ProductChange"("status");
CREATE INDEX IF NOT EXISTS "ProductChange_productId_idx" ON "ProductChange"("productId");

-- Every public table stays under RLS with no policies: deny-all for Supabase's
-- REST API, invisible to Prisma (which connects as the owner). See 0038.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
