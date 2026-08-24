-- Multi-location stock (Phase 1). The same item may now be held in more than one
-- location, so uniqueness moves from the SKU / barcode alone to the
-- (SKU, location) / (barcode, location) pair. Existing rows (one per SKU today)
-- satisfy the new constraint unchanged. Postgres treats NULLs as distinct, so
-- items with no SKU / barcode / location keep their prior freedom to repeat.
DROP INDEX IF EXISTS "StockItem_sku_key";
DROP INDEX IF EXISTS "StockItem_barcode_key";
CREATE UNIQUE INDEX IF NOT EXISTS "StockItem_sku_location_key" ON "StockItem" ("sku", "location");
CREATE UNIQUE INDEX IF NOT EXISTS "StockItem_barcode_location_key" ON "StockItem" ("barcode", "location");

-- Enable Row-Level Security on any public table (idempotent; no new table here,
-- but kept per the migration convention).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
