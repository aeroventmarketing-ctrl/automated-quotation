-- Warehouse: bin/shelf location + unit cost (for stock valuation).
ALTER TABLE "StockItem" ADD COLUMN "location" TEXT;
ALTER TABLE "StockItem" ADD COLUMN "unitCost" DECIMAL(14,2) NOT NULL DEFAULT 0;
