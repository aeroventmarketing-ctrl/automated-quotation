-- Manual departmental payroll for the profit-centre P&L. One row per department
-- per month (Manila YYYY-MM). Idempotent so it can be run safely in the Supabase
-- SQL editor.

CREATE TABLE IF NOT EXISTS "Payroll" (
  "id"            TEXT NOT NULL,
  "dept"          TEXT NOT NULL,
  "month"         TEXT NOT NULL,
  "amount"        DECIMAL(14,2) NOT NULL DEFAULT 0,
  "note"          TEXT,
  "createdByName" TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payroll_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Payroll_dept_month_key" ON "Payroll" ("dept", "month");
CREATE INDEX IF NOT EXISTS "Payroll_month_idx" ON "Payroll" ("month");
