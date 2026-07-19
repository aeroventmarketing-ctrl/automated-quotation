-- Logistics Head reconfirms receipt of the cash after the purchaser hands it over.
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'LOGISTICS_CONFIRMED';
