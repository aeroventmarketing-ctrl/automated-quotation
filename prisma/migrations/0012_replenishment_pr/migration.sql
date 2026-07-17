-- Replenishment purchase requests: a PurchaseRequest not tied to an order.
ALTER TABLE "PurchaseRequest" ALTER COLUMN "quotationId" DROP NOT NULL;
ALTER TABLE "PurchaseRequest" ALTER COLUMN "dept" DROP NOT NULL;
ALTER TABLE "PurchaseRequest" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'order';
ALTER TABLE "PurchaseRequest" ADD COLUMN "stockItemId" TEXT;
