-- Purchase Order issued to a supplier, stored on the purchase request.
ALTER TABLE "PurchaseRequest" ADD COLUMN "po" JSONB;
