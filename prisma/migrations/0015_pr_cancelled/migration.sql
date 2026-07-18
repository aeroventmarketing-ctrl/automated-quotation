-- Add CANCELLED to the purchase request status enum.
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
