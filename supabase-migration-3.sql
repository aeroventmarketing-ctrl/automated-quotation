-- AeroQuote — migration 3: quotation discount line + Excel "standard pattern".
-- Run ONCE in the Supabase SQL Editor BEFORE the new code deploys.

ALTER TABLE "Quotation"
  ADD COLUMN IF NOT EXISTS "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0;
