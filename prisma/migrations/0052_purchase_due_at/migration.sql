-- PurchaseRequest.purchaseDueAt — when this purchase has to be made by.
--
-- The owner: *"Add due date of purchase, purchaser or admin/payment approver can
-- add due date of purchase."* Production's job-order deadlines are set on the
-- order page, and until now nothing on the purchasing side recorded when the
-- BUYING had to happen to feed them.
--
-- A date, not a timestamp with meaning: a purchase is due on a calendar day, and
-- comparing it to "today" must give the same answer in every timezone the app is
-- read in. Stored as a timestamp for consistency with the other date columns in
-- this schema and normalised to midnight on write.
--
-- Creates no table, so no RLS block is needed (the table already has RLS from
-- 0038_enable_rls and keeps it).

alter table "PurchaseRequest"
  add column if not exists "purchaseDueAt" timestamp(3);
