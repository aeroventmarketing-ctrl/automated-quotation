-- CounterSale.slipReadCounts — AI "read slip" runs used, PER PROOF.
--
-- The owner, on an order's Payments Collected rows: *"in AI reading, allow
-- unlimited number of rows but limit to 3 reads per row. In the first picture,
-- 1st to 3rd row the AI reading is allowed but after the 4th row it message that
-- it exceeded the AI reading."*
--
-- `slipReads` was one number for the whole sale, spent by whichever payment row
-- was read first — so a sale with four proofs read three and refused the fourth,
-- which had never been read at all. The count belongs to the ATTACHMENT.
--
-- A JSON map keyed by storage path, matching how the order side keys its
-- `slipValidations`. The old `slipReads` column is LEFT IN PLACE and no longer
-- read: it counted the wrong thing, and mapping a whole sale's total onto
-- whichever proof is read next would charge that row for reads it never had.
-- Dropping it would also break any deploy that briefly runs the old code.
--
-- Creates no table, so no RLS block is needed (the table already has RLS from
-- 0038_enable_rls and keeps it).

alter table "CounterSale"
  add column if not exists "slipReadCounts" jsonb not null default '{}'::jsonb;
