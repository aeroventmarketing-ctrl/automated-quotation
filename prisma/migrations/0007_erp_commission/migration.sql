-- CreateTable
CREATE TABLE "Commission" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "salespersonId" TEXT NOT NULL,
    "salespersonName" TEXT NOT NULL,
    "orderValue" DECIMAL(14,2) NOT NULL,
    "ratePct" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "amount" DECIMAL(14,2) NOT NULL,
    "salesMonth" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "paidAt" TIMESTAMP(3),
    "paidByName" TEXT,

    CONSTRAINT "Commission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Commission_quotationId_key" ON "Commission"("quotationId");

-- CreateIndex
CREATE INDEX "Commission_salesMonth_idx" ON "Commission"("salesMonth");

-- CreateIndex
CREATE INDEX "Commission_salespersonId_idx" ON "Commission"("salespersonId");

-- CreateIndex
CREATE INDEX "Commission_paid_idx" ON "Commission"("paid");

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

