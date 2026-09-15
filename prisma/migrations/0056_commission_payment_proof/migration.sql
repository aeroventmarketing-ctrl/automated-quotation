-- Commission.paymentProof — the deposit slip or transfer screenshot behind a
-- payout.
--
-- The owner: *"add an option to attach proof of payment to sales personnel for
-- accounting, payment approver and admin. Proof of payment must be viewable by
-- sales account holder."*
--
-- The third pair of hands on the same row, and each pair writes its own column:
--
--   paid / paidAt / paidByName     Accounting: we released it
--   paymentProof                   Accounting / Approver / admin: here is the slip
--   receivedAt / receivedById /…   the salesperson: it reached me
--
-- An array (`[]` by default), because a payout can be evidenced by more than one
-- file — a bank slip and a screenshot of the transfer, say. Each entry is
-- { path, name, uploadedAt, uploadedById, uploadedByName }; the file itself lives
-- in Supabase Storage under `commissions/<salespersonId>/…`, which is what the
-- view route checks its permission against.
--
-- Creates no table, so no RLS block is needed (the table already has RLS from
-- 0038_enable_rls and keeps it).

alter table "Commission"
  add column if not exists "paymentProof" jsonb not null default '[]'::jsonb;
