-- AFBM quotation format: sales letter + VAT mode + project name
ALTER TABLE "User" ADD COLUMN "salesCode" TEXT;
ALTER TABLE "Quotation" ADD COLUMN "vatMode" TEXT NOT NULL DEFAULT 'INCLUSIVE';
ALTER TABLE "Quotation" ADD COLUMN "projectName" TEXT;
