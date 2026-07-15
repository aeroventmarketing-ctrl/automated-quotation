-- AeroQuote — migration 9: supplier Purchase Order on the purchase request.
-- Run ONCE in the Supabase SQL Editor BEFORE the new code deploys.

ALTER TABLE "PurchaseRequest"
  ADD COLUMN IF NOT EXISTS "po" JSONB;
