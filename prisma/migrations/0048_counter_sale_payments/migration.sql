-- Payments Collected on a counter sale.
--
-- A counter sale could record a payment METHOD and a single amount, but there
-- was nowhere to attach the proof of it — the GCash screenshot, the deposit
-- slip, the photo of the check. The order page has carried that list for a long
-- time (kind / amount / date / proof, with the AI "read slip"); this gives the
-- counter the same list.
--
--   payments  — SalePayment[]: { id, kind, amount, date, proof? }
--   slipReads — how many AI slip reads have been spent on this sale (the cap is
--               per sale and applies to everyone but an admin, exactly as it
--               does on an order).
--
-- Both are additive with defaults, so existing rows read as "no payments
-- recorded yet" and nothing else changes.

ALTER TABLE "CounterSale" ADD COLUMN IF NOT EXISTS "payments" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "CounterSale" ADD COLUMN IF NOT EXISTS "slipReads" INTEGER NOT NULL DEFAULT 0;

-- Every public table stays under RLS with no policies: deny-all for Supabase's
-- REST API, invisible to Prisma (which connects as the owner). See 0038.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
