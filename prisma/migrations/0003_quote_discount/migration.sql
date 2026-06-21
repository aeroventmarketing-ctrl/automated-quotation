-- Optional discount percentage shown as a "LESS x% DISCOUNT" line.
ALTER TABLE "Quotation" ADD COLUMN "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0;
