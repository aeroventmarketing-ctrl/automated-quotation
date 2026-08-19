-- Phase A (store ⇄ ERP unification): give each catalogue item its online-store
-- fields, so ONE record drives both the ERP/AeroQuote and the storefront.
-- Everything here is additive and optional — an item stays off the store until
-- storeListed is set. The website price is DERIVED from the AeroQuote price at
-- read time (round(price / 0.95)); it is never stored.
ALTER TABLE "CatalogueItem"
  ADD COLUMN IF NOT EXISTS "storeListed"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "storeSlug"        TEXT,
  ADD COLUMN IF NOT EXISTS "storeCategory"    TEXT,
  ADD COLUMN IF NOT EXISTS "storeDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "storePhotos"      JSONB NOT NULL DEFAULT '[]';

-- Unique slug (nullable — many unlisted items share NULL, which Postgres allows).
CREATE UNIQUE INDEX IF NOT EXISTS "CatalogueItem_storeSlug_key" ON "CatalogueItem" ("storeSlug");

-- Enable Row-Level Security on any public table (idempotent; no new table here,
-- but kept per the migration convention).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
