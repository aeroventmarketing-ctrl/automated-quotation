-- Stock reservations: soft-hold quantities against an order/job so available
-- stock = on-hand − active reservations.
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "stockItemId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "forRef" TEXT NOT NULL,
    "note" TEXT,
    "byName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedByName" TEXT,
    "releasedAt" TIMESTAMP(3),
    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StockReservation_stockItemId_idx" ON "StockReservation"("stockItemId");
CREATE INDEX "StockReservation_active_idx" ON "StockReservation"("active");
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "StockItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
