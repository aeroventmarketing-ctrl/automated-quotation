-- Proof of payment to BIR for each row of the EWT Summary (My Dashboard tile).
--
-- The owner: "to be considered paid, a proof of payment to BIR should be
-- uploaded". One row per (kind, refKey):
--   kind "supplier" — 1601-EQ, the EWT we withheld on a PO (refKey = PO batch id / request id)
--   kind "client"   — 1701Q, the EWT a client withheld on an order (refKey = quotation id)
--
-- Until this is applied the EWT Summary still shows every row (all Unpaid) and
-- an upload says to apply this migration.
CREATE TABLE IF NOT EXISTS "EwtRemittance" (
  "id"        TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "refKey"    TEXT NOT NULL,
  "proof"     JSONB NOT NULL,
  "byName"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EwtRemittance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EwtRemittance_kind_refKey_key" ON "EwtRemittance"("kind", "refKey");

-- Every public table stays under RLS with no policies (see 0038_enable_rls).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
