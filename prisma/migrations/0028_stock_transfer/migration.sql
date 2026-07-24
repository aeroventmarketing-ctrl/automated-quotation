-- Stock transfer between locations with a double-handshake receipt (production
-- head + purchaser). Idempotent so it can be run safely in the Supabase SQL editor.

DO $$ BEGIN
  CREATE TYPE "StockTransferStatus" AS ENUM ('IN_TRANSIT', 'RECEIVED', 'CANCELLED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "StockTransfer" (
  "id"              TEXT NOT NULL,
  "stockItemId"     TEXT,
  "destStockItemId" TEXT,
  "itemName"        TEXT NOT NULL,
  "unit"            TEXT NOT NULL DEFAULT 'pcs',
  "qty"             DECIMAL(14,3) NOT NULL,
  "fromLocation"    TEXT NOT NULL,
  "toLocation"      TEXT NOT NULL,
  "status"          "StockTransferStatus" NOT NULL DEFAULT 'IN_TRANSIT',
  "note"            TEXT,
  "proof"           JSONB,
  "initiatedById"   TEXT NOT NULL,
  "initiatedByName" TEXT NOT NULL,
  "initiatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "prodHeadById"    TEXT,
  "prodHeadByName"  TEXT,
  "prodHeadAt"      TIMESTAMP(3),
  "purchaserById"   TEXT,
  "purchaserByName" TEXT,
  "purchaserAt"     TIMESTAMP(3),
  "receivedAt"      TIMESTAMP(3),
  "cancelledByName" TEXT,
  "cancelledAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockTransfer_status_idx" ON "StockTransfer" ("status");
