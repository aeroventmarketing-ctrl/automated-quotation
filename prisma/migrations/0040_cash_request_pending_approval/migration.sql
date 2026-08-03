-- Cash requests now start awaiting Accounting's approve/reject before the voucher.
-- Add the new intake status. (ALTER TYPE ADD VALUE can't run inside a txn that
-- then uses the value, so this migration only adds the value — the app sets the
-- status explicitly on create; the column default is left unchanged.)
ALTER TYPE "CashRequestStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';
