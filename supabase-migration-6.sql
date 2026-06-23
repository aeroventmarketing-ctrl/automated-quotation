-- AeroQuote — migration 6: generic app settings (geofence / location access).
-- Run ONCE in the Supabase SQL Editor BEFORE the new code deploys.

CREATE TABLE IF NOT EXISTS "AppSetting" (
  "key"       TEXT PRIMARY KEY,
  "value"     JSONB NOT NULL DEFAULT '{}',
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now()
);
