-- Allow a Commission to belong to a walk-in Counter Sale (as an alternative to a
-- quotation/order). quotationId becomes nullable; a new counterSaleId is added.

ALTER TABLE "Commission" ALTER COLUMN "quotationId" DROP NOT NULL;
ALTER TABLE "Commission" ADD COLUMN IF NOT EXISTS "counterSaleId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Commission_counterSaleId_key" ON "Commission"("counterSaleId");

DO $$ BEGIN
  ALTER TABLE "Commission"
    ADD CONSTRAINT "Commission_counterSaleId_fkey"
    FOREIGN KEY ("counterSaleId") REFERENCES "CounterSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
