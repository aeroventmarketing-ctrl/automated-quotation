-- Double-handshake stock actions (edit / adjust / reserve / transfer).
DO $$ BEGIN
  CREATE TYPE "StockActionKind" AS ENUM ('EDIT', 'ADJUST', 'RESERVE', 'TRANSFER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "StockActionStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "StockAction" (
  "id" TEXT NOT NULL,
  "stockItemId" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "kind" "StockActionKind" NOT NULL,
  "payload" JSONB NOT NULL,
  "summary" TEXT NOT NULL,
  "status" "StockActionStatus" NOT NULL DEFAULT 'PENDING',
  "proposedById" TEXT NOT NULL,
  "proposedByName" TEXT NOT NULL,
  "proposedRole" TEXT NOT NULL,
  "proposedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "warehouseByName" TEXT,
  "warehouseAt" TIMESTAMP(3),
  "purchaserByName" TEXT,
  "purchaserAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "rejectedByName" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StockAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "StockAction_status_idx" ON "StockAction"("status");
CREATE INDEX IF NOT EXISTS "StockAction_stockItemId_idx" ON "StockAction"("stockItemId");
