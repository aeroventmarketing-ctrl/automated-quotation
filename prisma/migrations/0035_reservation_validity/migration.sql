-- Reservation validity / expiry date (optional).
ALTER TABLE "StockReservation" ADD COLUMN "validUntil" TIMESTAMP(3);
