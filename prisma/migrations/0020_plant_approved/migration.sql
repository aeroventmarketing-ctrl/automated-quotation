-- Plant Manager final-approves before the warehouseman receives into stock.
ALTER TYPE "PurchaseRequestStatus" ADD VALUE IF NOT EXISTS 'PLANT_APPROVED';
