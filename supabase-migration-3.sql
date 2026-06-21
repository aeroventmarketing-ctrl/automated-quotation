-- AeroQuote — migration 3: quotation discount + variable table unit labels.
-- Run ONCE in the Supabase SQL Editor BEFORE the new code deploys.

ALTER TABLE "Quotation"
  ADD COLUMN IF NOT EXISTS "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0;

ALTER TABLE "Quotation"
  ADD COLUMN IF NOT EXISTS "headerUnits" JSONB NOT NULL DEFAULT '{}';
