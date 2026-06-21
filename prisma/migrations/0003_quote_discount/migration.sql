-- Optional discount percentage shown as a "LESS x% DISCOUNT" line.
ALTER TABLE "Quotation" ADD COLUMN "discountPct" DECIMAL(5,2) NOT NULL DEFAULT 0;
-- Variable (red) table unit labels { capacity, pressure, motor }.
ALTER TABLE "Quotation" ADD COLUMN "headerUnits" JSONB NOT NULL DEFAULT '{}';
