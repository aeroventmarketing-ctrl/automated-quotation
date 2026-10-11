-- The Purchaser Plan: the two columns people fill in per MRF — Type ("Purchase
-- to supplier" / "For fabrication") and Client due date — each with who set it
-- and when. Every other column on the plan is read live from the order and its
-- purchase requests, so nothing here can go stale.
CREATE TABLE IF NOT EXISTS "PurchaserPlanEntry" (
  "id"              TEXT NOT NULL,
  "quotationId"     TEXT NOT NULL,
  "mrfId"           TEXT NOT NULL,
  "type"            TEXT,
  "typeByName"      TEXT,
  "typeAt"          TIMESTAMP(3),
  "clientDueDate"   TEXT,
  "clientDueByName" TEXT,
  "clientDueAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PurchaserPlanEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaserPlanEntry_mrfId_key" ON "PurchaserPlanEntry"("mrfId");
CREATE INDEX IF NOT EXISTS "PurchaserPlanEntry_quotationId_idx" ON "PurchaserPlanEntry"("quotationId");

-- Every public table stays under RLS with no policies (see 0038_enable_rls and
-- CLAUDE.md): deny-all for Supabase's public API, invisible to Prisma.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
