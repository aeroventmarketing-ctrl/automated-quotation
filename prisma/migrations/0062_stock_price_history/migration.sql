-- Price movement of each stock item: every change to its unit cost or selling
-- price, who made it, when, how, and who approved it.
--
-- The owner, on the Inventory tab: "Monitor the price movement of each items in
-- inventory, show the date of price movement, show who edited or changed the
-- price and when."
--
-- Until this is applied the app keeps working: price edits save as before (the
-- logger checks the table exists first), and the history page shows only the
-- changes it can rebuild from approved Edit requests, with a note to apply this.
CREATE TABLE IF NOT EXISTS "StockPriceChange" (
  "id"             TEXT NOT NULL,
  "stockItemId"    TEXT NOT NULL,
  "itemName"       TEXT NOT NULL,
  "sku"            TEXT,
  "oldUnitCost"    DECIMAL(14,2),
  "newUnitCost"    DECIMAL(14,2) NOT NULL,
  "oldSellPrice"   DECIMAL(14,2),
  "newSellPrice"   DECIMAL(14,2) NOT NULL,
  "source"         TEXT NOT NULL,
  "byName"         TEXT NOT NULL,
  "approvedByName" TEXT,
  "stockActionId"  TEXT,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockPriceChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockPriceChange_stockItemId_idx" ON "StockPriceChange"("stockItemId");
CREATE INDEX IF NOT EXISTS "StockPriceChange_createdAt_idx" ON "StockPriceChange"("createdAt");

-- Every public table stays under RLS with no policies (see 0038_enable_rls).
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;
