-- AeroQuote — migration 5: quotation product classification.
-- Run ONCE in the Supabase SQL Editor BEFORE the new code deploys.

ALTER TABLE "Quotation"
  ADD COLUMN IF NOT EXISTS "classification" JSONB NOT NULL DEFAULT '{}';
