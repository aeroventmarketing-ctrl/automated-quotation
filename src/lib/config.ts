/** Centralized, typed access to runtime config (env-driven, never hard-coded). */

export const config = {
  vatRate: Number(process.env.NEXT_PUBLIC_VAT_RATE ?? "0.12"),
  defaultCurrency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY ?? "PHP",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "attachments",
};

export const COMPANY = {
  name: "AEROVENT FANS & BLOWERS MANUFACTURING",
  tagline: "VENTILATION, AIR MOVING EQUIPMENT & ENGINEERING SPECIALISTS",
  manilaOffice:
    "Manila Office: 1933-C Augusto Francisco Street, Sta. Ana, Manila, Philippines",
  plantAddress:
    "Plant Address : #7635 Narra Road Bayan-bayanan San Vicente, San Pedro Laguna, Philippines",
  landline: "(02) 85619416  (LANDLINE)",
  mobile: "(SMART) - 09289480600 / 09996649997 / (GLOBE) – 09273258887 / 09544298999",
  email: "aeroventblower@gmail.com",
  website: "www.aeroventfbm.com",
  // Short code used as the AFBM quote-number prefix.
  quotePrefix: "AFBM",
  closing:
    "Thank you for giving us the opportunity to quote in your requirement, we shall await your valued order with much interest.",
  signoff: "Very Truly Yours,",
  signatory: "AEROVENT FBM",
  // Standard Terms & Conditions used when a quote (or its template) doesn't
  // specify its own. One numbered clause per line; "a."–"h." sub-items sit on
  // their own lines under their parent clause.
  defaultTerms: [
    "1. Payment : 50% down payment, 30% before delivery of items, 20% progress billing. VAT exclusive price. We accept Cash or Dated Check. Subject for bank clearing for check payment.",
    "2. Production time : 20 to 30 working days upon confirmation of P.O. & D.P. Sundays & Holidays not included.",
    "3. Delivery : Free delivery within Metro Manila.",
    "4. Storage fee : 30 days free of charge. Orders that exceed 30 days after the last billing statement will be charged 0.1% of the purchase order amount multiplied by exceeding number of storage days.",
    "5. Warranty :",
    "a. Six (6) months on motor except damages due to power interruption, power failure, power surge and substandard motor protector, substandard electrical practice and other user negligence.",
    "b. One (1) year on workmanship.",
    "c. Three (3) months for moving parts belts, pulley, shafting & bearing.",
    "d. Client shall provide an overload protection device against power fluctuation.",
    "e. Removing or altering any stickers and labels will void warranty.",
    "f. No warranty for Acts of Nature.",
    "g. Disassembly not performed by AFBM personnel will void the warranty.",
    "h. Warranty can only be availed if the unit has undergone Testing and Commissioning by AFBM.",
    "6. Upgrade : Epoxy Enamel Paint can be upgraded to Powder Coat / Oven Baked Paint at an additional cost.",
    "7. Commissioning : Testing and Commissioning is compulsory and free of charge within Metro Manila.",
    "8. Record : Dynamic Balancing Report and Vibration Analysis Data may be requested before scheduled delivery, otherwise additional charge will apply.",
    "9. Revisions : Any revision or alteration on the approved P.O. and/or quotation will be charged accordingly.",
    "10. Validity : Valid for one (1) week only or please verify prevailing prices.",
    "11. Cancellation : In the event of cancellation of Client's order/Purchase order for whatever reason/s not bound by AFBM, we reserve the right not to refund the payment made to cover damages for materials and manpower.",
    "12. Ownership : AFBM retains ownership of all merchandise until fully paid by Buyer. In case of payment default within one (1) year, AFBM reserves the right to use the product for whatever purpose at its discretion.",
  ].join("\n"),
};
