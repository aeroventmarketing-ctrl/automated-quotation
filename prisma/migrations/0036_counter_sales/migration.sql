-- Walk-in / over-the-counter cash sales (Counter Sales module).

DO $$ BEGIN
  CREATE TYPE "CounterSaleStatus" AS ENUM ('DRAFT', 'COMPLETED', 'VOID');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "CounterSale" (
  "id" TEXT NOT NULL,
  "saleNumber" TEXT,
  "customerId" TEXT NOT NULL,
  "vatMode" TEXT NOT NULL DEFAULT 'INCLUSIVE',
  "status" "CounterSaleStatus" NOT NULL DEFAULT 'DRAFT',
  "soldById" TEXT NOT NULL,
  "soldByName" TEXT NOT NULL,
  "salespersonId" TEXT,
  "salespersonName" TEXT,
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paymentMethod" TEXT NOT NULL DEFAULT 'cash',
  "paymentCleared" BOOLEAN NOT NULL DEFAULT false,
  "paymentDueAt" TIMESTAMP(3),
  "clearedByName" TEXT,
  "clearedAt" TIMESTAMP(3),
  "docs" JSONB NOT NULL DEFAULT '{}',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "voidedByName" TEXT,
  "voidedAt" TIMESTAMP(3),
  CONSTRAINT "CounterSale_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CounterSale_saleNumber_key" ON "CounterSale"("saleNumber");
CREATE INDEX IF NOT EXISTS "CounterSale_status_idx" ON "CounterSale"("status");
CREATE INDEX IF NOT EXISTS "CounterSale_customerId_idx" ON "CounterSale"("customerId");

CREATE TABLE IF NOT EXISTS "CounterSaleItem" (
  "id" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "stockItemId" TEXT,
  "description" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'pcs',
  "qty" DECIMAL(14,3) NOT NULL DEFAULT 1,
  "unitPrice" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "lineTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CounterSaleItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CounterSaleItem_saleId_idx" ON "CounterSaleItem"("saleId");

DO $$ BEGIN
  ALTER TABLE "CounterSale"
    ADD CONSTRAINT "CounterSale_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "CounterSaleItem"
    ADD CONSTRAINT "CounterSaleItem_saleId_fkey"
    FOREIGN KEY ("saleId") REFERENCES "CounterSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
