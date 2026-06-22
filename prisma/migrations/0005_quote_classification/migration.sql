-- Product classification from the selection workflow { category, type, bladeType, drive }.
ALTER TABLE "Quotation" ADD COLUMN "classification" JSONB NOT NULL DEFAULT '{}';
