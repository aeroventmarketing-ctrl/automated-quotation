-- Cash requests (cash vouchers): AeroVent's general money-request flow for cash
-- that isn't a supplier material PO (advances, reimbursements, petty cash,
-- expenses). Idempotent so it can be run safely in the Supabase SQL editor.

DO $$ BEGIN
  CREATE TYPE "CashRequestStatus" AS ENUM (
    'SUBMITTED', 'REJECTED', 'VOUCHER_READY', 'CASH_RELEASED', 'DISBURSED',
    'RECEIVED', 'LIQUIDATED', 'SETTLED', 'CANCELLED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "CashRequest" (
  "id"              TEXT NOT NULL,
  "number"          TEXT NOT NULL,
  "purpose"         TEXT NOT NULL,
  "category"        TEXT NOT NULL DEFAULT 'advance',
  "dept"            TEXT,
  "amount"          DECIMAL(14,2) NOT NULL,
  "lines"           JSONB NOT NULL DEFAULT '[]',
  "status"          "CashRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
  "requestedById"   TEXT NOT NULL,
  "requestedByName" TEXT NOT NULL,
  "note"            TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "voucherRef"      TEXT,
  "voucherByName"   TEXT,
  "voucherAt"       TIMESTAMP(3),
  "decidedByName"   TEXT,
  "decisionNote"    TEXT,
  "decidedAt"       TIMESTAMP(3),
  "releasedByName"  TEXT,
  "releasedAt"      TIMESTAMP(3),
  "disbursedByName" TEXT,
  "disbursedAt"     TIMESTAMP(3),
  "receivedByName"  TEXT,
  "receivedAt"      TIMESTAMP(3),
  "liquidation"     JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "CashRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CashRequest_number_key" ON "CashRequest" ("number");
CREATE INDEX IF NOT EXISTS "CashRequest_status_idx" ON "CashRequest" ("status");
CREATE INDEX IF NOT EXISTS "CashRequest_requestedById_idx" ON "CashRequest" ("requestedById");
