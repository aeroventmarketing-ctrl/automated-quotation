-- AeroQuote — schema + sample data for Supabase SQL Editor
-- Generated from prisma/seed.ts. Run once on an empty 'public' schema.
BEGIN;

-- ============ SCHEMA ============
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SALES', 'ENGINEER', 'ADMIN');

-- CreateEnum
CREATE TYPE "Family" AS ENUM ('AXIAL', 'CENTRIFUGAL', 'PROPELLER', 'TUBULAR_INLINE', 'CABINET', 'ACCESSORY', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "InquirySource" AS ENUM ('EMAIL', 'PHONE', 'WALK_IN', 'PHOTO', 'OTHER');

-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'DRAFTING', 'QUOTED', 'SENT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "InquiryItemStatus" AS ENUM ('PENDING', 'MATCHED', 'SELECTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PHOTO', 'SPEC_SHEET', 'DRAWING', 'OTHER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'SALES',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogueItem" (
    "id" TEXT NOT NULL,
    "family" "Family" NOT NULL,
    "modelCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sizeLabel" TEXT,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "uom" TEXT NOT NULL DEFAULT 'unit',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CatalogueItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListEntry" (
    "id" TEXT NOT NULL,
    "catalogueItemId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL DEFAULT 'default',
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "basePrice" DECIMAL(14,2) NOT NULL,
    "optionsJson" JSONB NOT NULL DEFAULT '{}',
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PriceListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FanRatingPoint" (
    "id" TEXT NOT NULL,
    "catalogueItemId" TEXT NOT NULL,
    "rpm" INTEGER NOT NULL,
    "airflow_m3hr" DOUBLE PRECISION NOT NULL,
    "staticPressure_pa" DOUBLE PRECISION NOT NULL,
    "power_kw" DOUBLE PRECISION NOT NULL,
    "efficiency" DOUBLE PRECISION,

    CONSTRAINT "FanRatingPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "source" "InquirySource" NOT NULL DEFAULT 'OTHER',
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InquiryItem" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "parsedJson" JSONB NOT NULL DEFAULT '{}',
    "qty" INTEGER NOT NULL DEFAULT 1,
    "status" "InquiryItemStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "InquiryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "quoteNumber" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'PHP',
    "validUntil" TIMESTAMP(3),
    "preparedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "notes" TEXT,
    "terms" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "catalogueItemId" TEXT,
    "descriptionSnapshot" TEXT NOT NULL,
    "specsSnapshot" JSONB NOT NULL DEFAULT '{}',
    "qty" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "selectionNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "layoutKey" TEXT NOT NULL,
    "headerHtml" TEXT,
    "footerHtml" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "QuotationTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "inquiryId" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteCounter" (
    "year" INTEGER NOT NULL,
    "lastValue" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteCounter_pkey" PRIMARY KEY ("year")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogueItem_modelCode_key" ON "CatalogueItem"("modelCode");

-- CreateIndex
CREATE INDEX "CatalogueItem_family_idx" ON "CatalogueItem"("family");

-- CreateIndex
CREATE INDEX "PriceListEntry_catalogueItemId_idx" ON "PriceListEntry"("catalogueItemId");

-- CreateIndex
CREATE INDEX "FanRatingPoint_catalogueItemId_idx" ON "FanRatingPoint"("catalogueItemId");

-- CreateIndex
CREATE INDEX "Inquiry_status_idx" ON "Inquiry"("status");

-- CreateIndex
CREATE INDEX "Inquiry_customerId_idx" ON "Inquiry"("customerId");

-- CreateIndex
CREATE INDEX "InquiryItem_inquiryId_idx" ON "InquiryItem"("inquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_quoteNumber_key" ON "Quotation"("quoteNumber");

-- CreateIndex
CREATE INDEX "Quotation_status_idx" ON "Quotation"("status");

-- CreateIndex
CREATE INDEX "Quotation_inquiryId_idx" ON "Quotation"("inquiryId");

-- CreateIndex
CREATE INDEX "QuotationItem_quotationId_idx" ON "QuotationItem"("quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "QuotationTemplate_layoutKey_key" ON "QuotationTemplate"("layoutKey");

-- CreateIndex
CREATE INDEX "Attachment_inquiryId_idx" ON "Attachment"("inquiryId");

-- AddForeignKey
ALTER TABLE "PriceListEntry" ADD CONSTRAINT "PriceListEntry_catalogueItemId_fkey" FOREIGN KEY ("catalogueItemId") REFERENCES "CatalogueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FanRatingPoint" ADD CONSTRAINT "FanRatingPoint_catalogueItemId_fkey" FOREIGN KEY ("catalogueItemId") REFERENCES "CatalogueItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InquiryItem" ADD CONSTRAINT "InquiryItem_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "QuotationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_catalogueItemId_fkey" FOREIGN KEY ("catalogueItemId") REFERENCES "CatalogueItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_inquiryId_fkey" FOREIGN KEY ("inquiryId") REFERENCES "Inquiry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ SEED DATA ============
INSERT INTO "User" (id,email,name,role) VALUES
 ('usr_sales','sales@aerovent.example','Sofia Sales','SALES'),
 ('usr_engineer','engineer@aerovent.example','Eduardo Engineer','ENGINEER'),
 ('usr_admin','admin@aerovent.example','Andrea Admin','ADMIN');
INSERT INTO "Customer" (id,company,"contactName",email,phone,address,notes) VALUES
 ('seed-customer-a',$txt$Metro Foods Manufacturing Inc.$txt$,$txt$Ramon Dela Cruz$txt$,$txt$ramon@metrofoods.example$txt$,$txt$+63 917 000 1111$txt$,$txt$Laguna Technopark, Biñan, Laguna$txt$,$txt$Kitchen exhaust + process ventilation. Prefers PHP quotes.$txt$),
 ('seed-customer-b',$txt$Department of Public Works (Regional Office)$txt$,$txt$Engr. Liza Santos$txt$,$txt$procurement@dpwh.example$txt$,$txt$+63 2 8000 2222$txt$,$txt$Quezon City, Metro Manila$txt$,$txt$Government / BAC procurement — requires detailed line items.$txt$);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_AX-400-D$txt$,'AXIAL',$txt$AX-400-D$txt$,$txt$Axial Flow Fan 400mm Direct$txt$,$txt$Direct-drive wall axial fan for general ventilation.$txt$,$txt$400mm$txt$,$j${"airflow_m3hr":[1000,6000],"staticPressure_pa":[0,250],"motorHp":[0.5,1],"drive":"direct","material":"MS"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_AX-400-D$txt$,$txt$cat_AX-400-D$txt$,'default',18500,$j${"Aluminum impeller":3500,"Epoxy coating":2200}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_AX-630-D$txt$,'AXIAL',$txt$AX-630-D$txt$,$txt$Axial Flow Fan 630mm Direct$txt$,$txt$High-volume axial fan for warehouses.$txt$,$txt$630mm$txt$,$j${"airflow_m3hr":[4000,16000],"staticPressure_pa":[0,350],"motorHp":[1,3],"drive":"direct","material":"MS"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_AX-630-D$txt$,$txt$cat_AX-630-D$txt$,'default',34500,$j${"Aluminum impeller":6500,"Bird screen":1800}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_AX-800-B$txt$,'AXIAL',$txt$AX-800-B$txt$,$txt$Axial Flow Fan 800mm Belt$txt$,$txt$Belt-driven axial fan for high static applications.$txt$,$txt$800mm$txt$,$j${"airflow_m3hr":[8000,30000],"staticPressure_pa":[0,500],"motorHp":[3,7.5],"drive":"belt","material":"MS"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_AX-800-B$txt$,$txt$cat_AX-800-B$txt$,'default',68000,$j${"VFD ready":4500}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_CF-355-BI$txt$,'CENTRIFUGAL',$txt$CF-355-BI$txt$,$txt$Centrifugal Blower 355 Backward$txt$,$txt$Backward-inclined centrifugal for medium pressure.$txt$,$txt$355mm$txt$,$j${"airflow_m3hr":[1500,9000],"staticPressure_pa":[200,1500],"motorHp":[1,5],"drive":"belt","material":"MS","wheel":"backward-inclined"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_CF-355-BI$txt$,$txt$cat_CF-355-BI$txt$,'default',56000,$j${"SS304 wheel":18000,"Inlet damper":7500}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_CF-450-FC$txt$,'CENTRIFUGAL',$txt$CF-450-FC$txt$,$txt$Centrifugal Blower 450 Forward$txt$,$txt$Forward-curved centrifugal for HVAC supply.$txt$,$txt$450mm$txt$,$j${"airflow_m3hr":[3000,14000],"staticPressure_pa":[150,900],"motorHp":[2,7.5],"drive":"belt","material":"MS","wheel":"forward-curved"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_CF-450-FC$txt$,$txt$cat_CF-450-FC$txt$,'default',72000,$j${"Spark-resistant":22000}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_CF-560-BI$txt$,'CENTRIFUGAL',$txt$CF-560-BI$txt$,$txt$Centrifugal Blower 560 Backward$txt$,$txt$High-efficiency backward-inclined for dust collection.$txt$,$txt$560mm$txt$,$j${"airflow_m3hr":[6000,22000],"staticPressure_pa":[500,2500],"motorHp":[5,15],"drive":"belt","material":"MS","wheel":"backward-inclined"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_CF-560-BI$txt$,$txt$cat_CF-560-BI$txt$,'default',118000,$j${"Abrasion liner":28000,"Drain":1500}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_CF-710-RT$txt$,'CENTRIFUGAL',$txt$CF-710-RT$txt$,$txt$Centrifugal Blower 710 Radial$txt$,$txt$Radial-tip blower for high-pressure material handling.$txt$,$txt$710mm$txt$,$j${"airflow_m3hr":[8000,28000],"staticPressure_pa":[1000,4000],"motorHp":[10,30],"drive":"belt","material":"MS","wheel":"radial"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_CF-710-RT$txt$,$txt$cat_CF-710-RT$txt$,'default',196000,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_PR-600-W$txt$,'PROPELLER',$txt$PR-600-W$txt$,$txt$Wall Propeller Fan 600mm$txt$,$txt$Economical wall-mount propeller exhaust fan.$txt$,$txt$600mm$txt$,$j${"airflow_m3hr":[3000,9000],"staticPressure_pa":[0,80],"motorHp":[0.5,1],"drive":"direct","material":"MS"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_PR-600-W$txt$,$txt$cat_PR-600-W$txt$,'default',12500,$j${"Auto shutter":2800}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_PR-900-W$txt$,'PROPELLER',$txt$PR-900-W$txt$,$txt$Wall Propeller Fan 900mm$txt$,$txt$Large wall propeller for factory exhaust.$txt$,$txt$900mm$txt$,$j${"airflow_m3hr":[9000,24000],"staticPressure_pa":[0,100],"motorHp":[1,2],"drive":"direct","material":"MS"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_PR-900-W$txt$,$txt$cat_PR-900-W$txt$,'default',22000,$j${"Auto shutter":4200}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_TI-315$txt$,'TUBULAR_INLINE',$txt$TI-315$txt$,$txt$Tubular Inline Fan 315mm$txt$,$txt$Inline duct fan for balanced ventilation.$txt$,$txt$315mm$txt$,$j${"airflow_m3hr":[800,4000],"staticPressure_pa":[50,400],"motorHp":[0.5,1.5],"drive":"direct","material":"GI"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_TI-315$txt$,$txt$cat_TI-315$txt$,'default',28000,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_TI-400$txt$,'TUBULAR_INLINE',$txt$TI-400$txt$,$txt$Tubular Inline Fan 400mm$txt$,$txt$Medium inline duct fan.$txt$,$txt$400mm$txt$,$j${"airflow_m3hr":[2000,8000],"staticPressure_pa":[80,500],"motorHp":[1,3],"drive":"direct","material":"GI"}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_TI-400$txt$,$txt$cat_TI-400$txt$,'default',41000,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_CB-15$txt$,'CABINET',$txt$CB-15$txt$,$txt$Cabinet Exhaust Fan 1.5HP$txt$,$txt$Acoustic cabinet fan for low-noise exhaust.$txt$,$txt$Size 15$txt$,$j${"airflow_m3hr":[2500,10000],"staticPressure_pa":[200,800],"motorHp":[1.5,3],"drive":"belt","material":"GI","insulated":true}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_CB-15$txt$,$txt$cat_CB-15$txt$,'default',88000,$j${"Acoustic lining upgrade":15000}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_CB-30$txt$,'CABINET',$txt$CB-30$txt$,$txt$Cabinet Supply Fan 3HP$txt$,$txt$Insulated cabinet fan for fresh-air supply.$txt$,$txt$Size 30$txt$,$j${"airflow_m3hr":[5000,18000],"staticPressure_pa":[300,1200],"motorHp":[3,7.5],"drive":"belt","material":"GI","insulated":true}$j$::jsonb,$txt$unit$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_CB-30$txt$,$txt$cat_CB-30$txt$,'default',142000,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_ACC-VCD-400$txt$,'ACCESSORY',$txt$ACC-VCD-400$txt$,$txt$Volume Control Damper 400mm$txt$,$txt$Opposed-blade VCD, galvanized.$txt$,$txt$400mm$txt$,$j${"material":"GI"}$j$::jsonb,$txt$pc$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_ACC-VCD-400$txt$,$txt$cat_ACC-VCD-400$txt$,'default',6500,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_ACC-FLEX-300$txt$,'ACCESSORY',$txt$ACC-FLEX-300$txt$,$txt$Flexible Connector 300mm$txt$,$txt$Fabric flexible duct connector.$txt$,$txt$300mm$txt$,$j${"material":"Neoprene fabric"}$j$::jsonb,$txt$pc$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_ACC-FLEX-300$txt$,$txt$cat_ACC-FLEX-300$txt$,'default',1800,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_ACC-WC-630$txt$,'ACCESSORY',$txt$ACC-WC-630$txt$,$txt$Weather Cowl 630mm$txt$,$txt$Galvanized weather cowl with bird screen.$txt$,$txt$630mm$txt$,$j${"material":"GI"}$j$::jsonb,$txt$pc$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_ACC-WC-630$txt$,$txt$cat_ACC-WC-630$txt$,'default',9500,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_ACC-AS-600$txt$,'ACCESSORY',$txt$ACC-AS-600$txt$,$txt$Gravity Shutter 600mm$txt$,$txt$Aluminum gravity back-draft shutter.$txt$,$txt$600mm$txt$,$j${"material":"Aluminum"}$j$::jsonb,$txt$pc$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_ACC-AS-600$txt$,$txt$cat_ACC-AS-600$txt$,'default',4200,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_SVC-BAL$txt$,'SERVICE',$txt$SVC-BAL$txt$,$txt$Dynamic Balancing$txt$,$txt$On-site dynamic balancing of impeller/rotor (per unit).$txt$,NULL,$j${"type":"service"}$j$::jsonb,$txt$service$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_SVC-BAL$txt$,$txt$cat_SVC-BAL$txt$,'default',8500,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_SVC-LASER-PB$txt$,'SERVICE',$txt$SVC-LASER-PB$txt$,$txt$Laser Pulley/Belt Alignment$txt$,$txt$Laser pulley & belt alignment (per drive).$txt$,NULL,$j${"type":"service"}$j$::jsonb,$txt$service$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_SVC-LASER-PB$txt$,$txt$cat_SVC-LASER-PB$txt$,'default',6500,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_SVC-LASER-SH$txt$,'SERVICE',$txt$SVC-LASER-SH$txt$,$txt$Laser Shaft Alignment$txt$,$txt$Laser shaft alignment for direct-coupled sets.$txt$,NULL,$j${"type":"service"}$j$::jsonb,$txt$service$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_SVC-LASER-SH$txt$,$txt$cat_SVC-LASER-SH$txt$,'default',7500,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_SVC-MEGGER$txt$,'SERVICE',$txt$SVC-MEGGER$txt$,$txt$Motor Insulation Testing$txt$,$txt$Megger / motor insulation resistance test (per motor).$txt$,NULL,$j${"type":"service"}$j$::jsonb,$txt$service$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_SVC-MEGGER$txt$,$txt$cat_SVC-MEGGER$txt$,'default',3500,$j${}$j$::jsonb);
INSERT INTO "CatalogueItem" (id,family,"modelCode",name,description,"sizeLabel",specs,uom) VALUES ($txt$cat_OTH-CUSTOM$txt$,'OTHER',$txt$OTH-CUSTOM$txt$,$txt$Custom Fabrication (TBD)$txt$,$txt$Custom fabricated unit — priced on engineering review.$txt$,NULL,$j${"type":"custom"}$j$::jsonb,$txt$lot$txt$);
INSERT INTO "PriceListEntry" (id,"catalogueItemId","variantKey","basePrice","optionsJson") VALUES ($txt$price_OTH-CUSTOM$txt$,$txt$cat_OTH-CUSTOM$txt$,'default',0,$j${}$j$::jsonb);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_1$txt$,$txt$cat_AX-630-D$txt$,1440,0,350,1.2,0);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_2$txt$,$txt$cat_AX-630-D$txt$,1440,4000,320,1.8,0.55);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_3$txt$,$txt$cat_AX-630-D$txt$,1440,8000,260,2.4,0.68);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_4$txt$,$txt$cat_AX-630-D$txt$,1440,12000,170,2.9,0.62);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_5$txt$,$txt$cat_AX-630-D$txt$,1440,16000,40,3.2,0.4);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_6$txt$,$txt$cat_CF-355-BI$txt$,2900,0,1500,1.5,0);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_7$txt$,$txt$cat_CF-355-BI$txt$,2900,1500,1400,2.2,0.58);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_8$txt$,$txt$cat_CF-355-BI$txt$,2900,4500,1100,3.5,0.74);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_9$txt$,$txt$cat_CF-355-BI$txt$,2900,7000,700,4.2,0.7);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_10$txt$,$txt$cat_CF-355-BI$txt$,2900,9000,300,4.6,0.55);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_11$txt$,$txt$cat_CF-560-BI$txt$,1750,0,2500,4,0);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_12$txt$,$txt$cat_CF-560-BI$txt$,1750,6000,2300,6.5,0.6);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_13$txt$,$txt$cat_CF-560-BI$txt$,1750,12000,1800,9.5,0.78);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_14$txt$,$txt$cat_CF-560-BI$txt$,1750,18000,1100,11.5,0.72);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_15$txt$,$txt$cat_CF-560-BI$txt$,1750,22000,400,12.5,0.55);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_16$txt$,$txt$cat_TI-400$txt$,1400,0,500,0.5,0);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_17$txt$,$txt$cat_TI-400$txt$,1400,2000,450,0.9,0.6);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_18$txt$,$txt$cat_TI-400$txt$,1400,4500,350,1.4,0.71);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_19$txt$,$txt$cat_TI-400$txt$,1400,6500,200,1.7,0.64);
INSERT INTO "FanRatingPoint" (id,"catalogueItemId",rpm,"airflow_m3hr","staticPressure_pa","power_kw",efficiency) VALUES ($txt$rp_20$txt$,$txt$cat_TI-400$txt$,1400,8000,60,1.9,0.45);
INSERT INTO "QuotationTemplate" (id,name,"layoutKey",config) VALUES ($txt$tpl_standard$txt$,$txt$Standard$txt$,$txt$standard$txt$,$j${"accent":"#1d4ed8","showSpecs":true,"showTerms":true}$j$::jsonb);
INSERT INTO "QuotationTemplate" (id,name,"layoutKey",config) VALUES ($txt$tpl_government$txt$,$txt$Government / BAC$txt$,$txt$government$txt$,$j${"accent":"#065f46","showSpecs":true,"showTerms":true,"showAbcNote":true}$j$::jsonb);
INSERT INTO "QuotationTemplate" (id,name,"layoutKey",config) VALUES ($txt$tpl_detailed$txt$,$txt$Detailed Engineering$txt$,$txt$detailed$txt$,$j${"accent":"#7c3aed","showSpecs":true,"showSelectionNotes":true,"showTerms":true}$j$::jsonb);
INSERT INTO "QuotationTemplate" (id,name,"layoutKey",config) VALUES ($txt$tpl_budgetary$txt$,$txt$Quick Budgetary$txt$,$txt$budgetary$txt$,$j${"accent":"#b45309","showSpecs":false,"budgetary":true}$j$::jsonb);
INSERT INTO "QuotationTemplate" (id,name,"layoutKey",config) VALUES ($txt$tpl_export$txt$,$txt$Export / USD$txt$,$txt$export$txt$,$j${"accent":"#0f766e","currency":"USD","showSpecs":true,"showTerms":true}$j$::jsonb);
INSERT INTO "Inquiry" (id,"customerId",source,status,"createdById",notes) VALUES
 ('seed-inquiry-1','seed-customer-a','EMAIL','DRAFTING','usr_sales',$txt$Emailed RFQ for kitchen + process exhaust.$txt$),
 ('seed-inquiry-2','seed-customer-b','PHOTO','NEW','usr_sales',$txt$Walk-in client handed a photo of an old fan nameplate.$txt$);
INSERT INTO "InquiryItem" (id,"inquiryId","rawText","parsedJson",qty,status) VALUES
 ('ii_1','seed-inquiry-1',$txt$Need an exhaust fan ~5000 CFM at 1 inWG for kitchen hood. Qty 2.$txt$,$j${"description":"Kitchen hood exhaust fan","airflow":5000,"airflowUnit":"CFM","staticPressure":1,"pressureUnit":"inWG","qty":2,"application":"kitchen exhaust","modelText":null}$j$::jsonb,2,'PENDING'),
 ('ii_2','seed-inquiry-1',$txt$Centrifugal blower for dust collection, around 10,000 m3/hr at 1500 Pa.$txt$,$j${"description":"Dust collection centrifugal blower","airflow":10000,"airflowUnit":"m3/hr","staticPressure":1500,"pressureUnit":"Pa","qty":1,"application":"dust collection","modelText":null}$j$::jsonb,1,'PENDING'),
 ('ii_3','seed-inquiry-2',$txt$From nameplate photo: Axial fan, 8000 m3/hr, 200 Pa, 2HP, 1440 rpm.$txt$,$j${"description":"Replacement axial fan (from nameplate)","airflow":8000,"airflowUnit":"m3/hr","staticPressure":200,"pressureUnit":"Pa","qty":1,"application":"general ventilation","modelText":"OLD-AX-2HP 1440rpm"}$j$::jsonb,1,'PENDING');
INSERT INTO "Attachment" (id,"inquiryId","storagePath",kind) VALUES ('att_1','seed-inquiry-2','samples/nameplate-demo.jpg','PHOTO');

COMMIT;
