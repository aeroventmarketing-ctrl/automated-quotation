-- AeroQuote — migration 2: real AFBM quotation format
-- Run ONCE in the Supabase SQL Editor BEFORE the new code deploys.
-- Adds: User.salesCode, Quotation.vatMode, Quotation.projectName
-- and loads Pattern #1 (Standard – Fans & Blowers) terms + spec note.

BEGIN;

-- 1) New columns -------------------------------------------------------------
ALTER TABLE "User"      ADD COLUMN IF NOT EXISTS "salesCode"   TEXT;
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "vatMode"     TEXT NOT NULL DEFAULT 'INCLUSIVE';
ALTER TABLE "Quotation" ADD COLUMN IF NOT EXISTS "projectName" TEXT;

-- 2) Pattern #1 — Standard (Fans & Blowers): name + terms + spec note --------
UPDATE "QuotationTemplate"
SET name = 'Standard – Fans & Blowers',
    config = jsonb_build_object(
      'accent', '#0f766e',
      'specNote', $sn$All units are made of high quality materials. Designed and built for continuous duty operation. Statically and Dynamically balanced. Without installed Inlet Safety and Outlet Safety Screen as standard. Installed with TECO / TECO MONARCH / HYUNDAI TEFC Induction Motor.$sn$,
      'terms', $tc$1. Payment : 50% down payment, 50% before delivery of order. VAT inclusive price. We accept Cash, Dated Check, Credit Card, Debit Card and other online payments. Subject for bank clearing for check payment.

2. Production time : 25 to 30 working days upon confirmation of P.O. & down payment. Sundays and Holidays not included.

3. Delivery : Subject for bank clearing for check payment. Free delivery within Metro Manila.

4. Storage fee : 30 days free of charge. Orders that exceed 30 days after the last billing statement will be charged 0.1% of the purchase order amount multiplied by exceeding number of storage days.

5. Warranty :
   a. Six (6) months on motor except damages due to power interruption, power failure, power surge and substandard motor protector, substandard electrical practice and other user negligence. Motor supplied by customer will not be included in the said warranty.
   b. One (1) year on workmanship.
   c. Three (3) months for moving parts belts, pulley, shafting & bearing.
   d. Client shall provide an overload protection device against power fluctuation.
   e. Removing or altering any stickers and labels will void warranty.
   f. No warranty for Acts of Nature.
   g. Disassembly not performed by AFBM personnel will void the warranty.
   h. Warranty can only be availed if the unit has undergone Testing and Commissioning by AFBM.

6. Upgrade : Epoxy Enamel Paint can be upgraded to Powder Coat / Oven Baked Paint at an additional cost.

7. Commissioning : One time on-site Testing and Commissioning is compulsory and free of charge within Metro Manila.

8. Record : Dynamic Balancing Report and Vibration Analysis Data may be requested before scheduled delivery, otherwise additional charge will apply to cover the setup and transportation cost for machine testing.

9. Revisions : Any revision or alteration on the approved P.O. and/or quotation will be charged accordingly.

10. Validity : Valid for one (1) week only or please verify prevailing prices.

11. Cancellation : In the event of cancellation of Client's order/Purchase order for whatever reason/s not bound by AFBM, we reserve the right not to refund the payment made to cover damages for materials and manpower.

12. Ownership : AFBM retains ownership of all merchandise until fully paid by Buyer. In case of payment default within the period of one (1) year, AFBM reserves the right to use the product for whatever purpose at its discretion.$tc$
    )
WHERE "layoutKey" = 'standard';

COMMIT;
