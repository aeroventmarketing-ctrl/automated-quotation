-- External barcode (GS1 GTIN / UPC / EAN) on a stock item — the supplier's /
-- manufacturer's printed barcode, kept SEPARATE from our internal SKU (which we
-- encode on our own Code128/QR labels). Additive & optional: an item has none
-- until one is scanned/entered. Unique so a barcode resolves to one item, but
-- nullable, and Postgres allows many NULLs under a unique index.
ALTER TABLE "StockItem" ADD COLUMN IF NOT EXISTS "barcode" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "StockItem_barcode_key" ON "StockItem" ("barcode");

-- Enable Row-Level Security on any public table (idempotent; no new table here,
-- but kept per the migration convention).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
