-- Purchaser reconfirms receipt of the cash & check after Accounting hands it over.
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'CASH_CONFIRMED';
