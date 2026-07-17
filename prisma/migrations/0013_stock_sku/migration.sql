-- Short SKU / scan code for stock items (compact barcodes + human-friendly).
ALTER TABLE "StockItem" ADD COLUMN "sku" TEXT;
CREATE UNIQUE INDEX "StockItem_sku_key" ON "StockItem"("sku");
