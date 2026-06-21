-- AeroQuote — migration 4: inquiry project name.
-- Run ONCE in the Supabase SQL Editor BEFORE the new code deploys.

ALTER TABLE "Inquiry"
  ADD COLUMN IF NOT EXISTS "projectName" TEXT;
