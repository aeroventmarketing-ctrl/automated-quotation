-- A photo of the CHECK, attached to the PO it paid for.
--
-- Owner's rule: *"Check is required for suppliers that give terms to us."* The
-- photo is attached on the PO row in Purchasing by Accounting, the Payment
-- Approver or an admin, and is kept for future reference when the check is later
-- queried by the supplier or the bank.
--
-- A JSON array of [{ path, name, uploadedAt, uploadedByName }] on the PO's anchor
-- PurchaseRequest — a combined PO covering several requests has one anchor, so it
-- has one check, which is the truth of it: one check is written per PO.
--
-- Creates no table, so no RLS block is needed (the table already has RLS from
-- 0038_enable_rls and keeps it).

alter table "PurchaseRequest"
  add column if not exists "voucherCheckDocs" jsonb not null default '[]';
