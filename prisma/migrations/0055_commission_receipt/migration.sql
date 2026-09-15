-- Commission.receivedAt / receivedById / receivedByName — the salesperson's own
-- acknowledgement that the money reached them.
--
-- The owner: *"show a link in every sales personnel. Link can be clickable by
-- sales personnel when receiving commissions. Once clicked it will be the proof
-- that the sales personnel received the amount."*
--
-- `paidAt` / `paidByName` already record what ACCOUNTING did: released the money.
-- These three record what the SALESPERSON says: it arrived. They are deliberately
-- separate columns rather than a second meaning for the first pair, because the
-- whole value of the record is that a different person wrote it — a receipt
-- Accounting could stamp on the payee's behalf would prove nothing.
--
-- `receivedById` is kept alongside the name so the proof survives a rename: the
-- name is what a person reads, the id is what it can be checked against.
--
-- Creates no table, so no RLS block is needed (the table already has RLS from
-- 0038_enable_rls and keeps it).

alter table "Commission"
  add column if not exists "receivedAt" timestamp(3),
  add column if not exists "receivedById" text,
  add column if not exists "receivedByName" text;
