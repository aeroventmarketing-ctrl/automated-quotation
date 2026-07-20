/** Centralized, typed access to runtime config (env-driven, never hard-coded). */

export const config = {
  vatRate: Number(process.env.NEXT_PUBLIC_VAT_RATE ?? "0.12"),
  defaultCurrency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY ?? "PHP",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  // Current vision-capable default; override with ANTHROPIC_MODEL (e.g.
  // "claude-haiku-4-5-20251001" for lower cost on receipt reading).
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
  // Optional: your Anthropic price per 1M tokens (USD), used only to show an
  // estimated cost on the AI-usage page. Leave unset to display token counts
  // only (no fabricated pricing). Find current rates on the Anthropic console.
  anthropicPriceInputPerM: Number(process.env.ANTHROPIC_PRICE_INPUT_PER_M ?? "0"),
  anthropicPriceOutputPerM: Number(process.env.ANTHROPIC_PRICE_OUTPUT_PER_M ?? "0"),
  // Trim stray whitespace from the env value — a leading/trailing space makes
  // the bucket name invalid (Supabase rejects "  attachments"). Fall back to the
  // default when the variable is unset or only whitespace.
  storageBucket: (process.env.SUPABASE_STORAGE_BUCKET ?? "").trim() || "attachments",
  // Automated client follow-up emails (Resend). The "from" must be an address on
  // a domain verified in Resend (a Gmail address will not work).
  followUpFromName: (process.env.FOLLOW_UP_FROM_NAME ?? "").trim() || "AEROVENT FBM",
  followUpFromEmail: (process.env.FOLLOW_UP_FROM_EMAIL ?? "").trim(),
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
  // Supplier Purchase Order footer — AEROVENT's payee details and default remark.
  poBank: { bank: "BDO", name: "RAMON F CHONG WING SAU", number: "002830007375" },
  poGcash: { name: "RYANN CHONG", number: "09178305514" },
  poDefaultRemarks: "Payment via Cash / GCASH / Online banking",
  poSignatoryTitle: "Account Purchaser",
  closing:
    "Thank you for giving us the opportunity to quote in your requirement, we shall await your valued order with much interest.",
  signoff: "Very Truly Yours,",
  signatory: "AEROVENT FBM",
  // Standard Terms & Conditions used when a quote (or its template) doesn't
  // specify its own. One numbered clause per line; "a."–"h." sub-items sit on
  // their own lines under their parent clause.
  defaultTerms: [
    "1. Payment : 50% down payment, 30% before delivery of items, 20% progress billing. VAT exclusive price.",
    "We accept Cash or Dated Check and online payments. Subject for bank clearing for check payment.",
    "2. Production time : 20 to 30 working days upon confirmation of P.O. & D.P. Sundays & Holidays not included.",
    "3. Delivery : Subject for bank clearing for check payment. Free delivery within Metro Manila.",
    "4. Storage fee : 30 days free of charge. Orders that exceed 30 days after the last billing statement will be charged 0.1% of the purchase order amount multiplied by exceeding number of storage days.",
    "5. Warranty :",
    "a. Six (6) months on motor except damages due to power interruption, power failure, power surge and substandard motor protector, substandard electrical practice and other user negligence. Motor supplied by customer will not be included in the said warranty.",
    "b. One (1) year on workmanship.",
    "c. Three (3) months for moving parts belts, pulley, shafting & bearing.",
    "d. Client shall provide and overload protection device against power fluctuation.",
    "e. Removing or altering any stickers and labels will void warranty.",
    "f. No warranty for Acts of Nature.",
    "g. Disassembly not performed by AFBM personnel will void the warranty.",
    "h. Warranty can only be availed if the unit has undergone Testing and Commissioning by AFBM.",
    "6. Upgrade : Epoxy Enamel Paint can be upgraded to Powder Coat / Oven Baked Paint at an additional cost.",
    "7. Commissioning : Testing and Commissioning is compulsory and free of charge within Metro Manila.",
    "8. Record : Dynamic Balancing Report and Vibration Analysis Data may be requested before scheduled delivery otherwise additional charge will apply to cover the setup and transportation cost for machine testing. Client is entitled for a one time on-site testing.",
    "9. Revisions : Any revision or alteration on the approved P.O. and/or quotation will be charged accordingly.",
    "10. Validity : Valid for one (1) week only or please verify prevailing prices.",
    "11. Cancellation : In the event of cancellation of Client's order/P.O. for whatever reason/s not bound by AFBM. We serve the right not to refund the payment made to cover damages for materials and manpower.",
    "12. Ownership : AFBM retains ownership of all merchandise until fully paid by Buyer. In case of payment default within the period of one (1) year. AFBM reserves the right to use the product for whatever purpose at its discretion.",
  ].join("\n"),

  // Terms & conditions for the "Power Roof Ventilator" template. 50/50 payment
  // (VAT exclusive), 25–30 day production, and a roof-specific warranty clause
  // (c. leak responsibility within 2 m of the installed unit).
  powerRoofVentilatorTerms: [
    "1. Payment : 50% down payment, 50% before delivery of order. VAT exclusive price.",
    "We accept Cash, Dated Check, Credit Card, Debit Card and other online payments.",
    "Subject for bank clearing for check payment.",
    "2. Production time : 25 to 30 working days upon confirmation of P.O. & down payment. Sundays and Holidays not included.",
    "3. Delivery : Subject for bank clearing for check payment. Free delivery within Metro Manila.",
    "4. Storage fee : 30 days free of charge. Orders that exceed 30 days after the last billing statement will be charged 0.1% of the purchase order amount multiplied by exceeding number of storage days.",
    "5. Warranty :",
    "a. Six (6) months on motor except damages due to power interruption, power failure, power surge and substandard motor protector, substandard electrical practice and other user negligence. Motor supplied by customer will not be included in the said warranty.",
    "b. One (1) year on workmanship.",
    "c. For installation made by AFBM. Leak within 2 meters from the installed unit will be AFBM's responsibility. More than 2 meter will be at client's expense.",
    "d. Three (3) months for moving parts belts, pulley, shafting & bearing.",
    "e. Client shall provide and overload protection device against power fluctuation.",
    "f. Removing or altering any stickers and labels will void warranty.",
    "g. Warranty can only be availed if the unit has undergone Testing and Commissioning by AFBM.",
    "h. No warranty for Acts of Nature.",
    "6. Upgrade : Epoxy Enamel Paint can be upgraded to Powder Coat / Oven Baked Paint at an additional cost.",
    "7. Commissioning : Testing and Commissioning is compulsory and free of charge within Metro Manila.",
    "8. Record : Dynamic Balancing Report and Vibration Analysis Data may be requested before scheduled delivery otherwise additional charge will apply to cover the setup and transportation cost for machine testing. Client is entitled for a one time on-site testing.",
    "9. Revisions : Any revision or alteration on the approved P.O. and/or quotation will be charged accordingly.",
    "10. Validity : Valid for one (1) week only or please verify prevailing prices.",
    "11. Cancellation : In the event of cancellation of Client's order/Purchase order for whatever reason/s not bound by AFBM. We serve the right not to refund the payment made to cover damages for materials and manpower.",
    "12. Ownership : AFBM retains ownership of all merchandise until fully paid by Buyer. In case of payment default within the period of one (1) year. AFBM reserves the right to use the product for whatever purpose at its discretion.",
  ].join("\n"),

  // Terms & conditions for the "Wind Driven Roof Vent" template. 50/50 payment
  // (VAT exclusive), 15–20 day production, delivery charge not included, and a
  // no-motor warranty (workmanship, roof-leak clause, no Acts of Nature).
  windDrivenRoofVentTerms: [
    "1. Payment : 50% down payment, 50% before delivery of order. VAT exclusive price.",
    "We accept Cash, Dated Check, Credit Card, Debit Card and other online payments.",
    "Subject for bank clearing for check payment.",
    "2. Production time : 15 to 20 working days upon confirmation of P.O. & down payment. Sundays and Holidays not included.",
    "3. Delivery : Subject for bank clearing for check payment. Delivery charge not included.",
    "4. Storage fee : 30 days free of charge. Orders that exceed 30 days after the last billing statement will be charged 0.1% of the purchase order amount multiplied by exceeding number of storage days.",
    "5. Warranty :",
    "a. One (1) year on workmanship.",
    "b. For installation made by AFBM. Leak within 2 meters from the installed unit will be AFBM's responsibility. More than 2 meter will be at client's expense.",
    "c. No warranty for Acts of Nature.",
    "6. Revisions : Any revision or alteration on the approved P.O. and/or quotation will be charged accordingly.",
    "7. Validity : Valid for one (1) week only or please verify prevailing prices.",
    "8. Cancellation : In the event of cancellation of Client's order/Purchase order for whatever reason/s not bound by AFBM. We serve the right not to refund the payment made to cover damages for materials and manpower.",
    "9. Ownership : AFBM retains ownership of all merchandise until fully paid by Buyer. In case of payment default within the period of one (1) year. AFBM reserves the right to use the product for whatever purpose at its discretion.",
  ].join("\n"),

  // Terms & conditions for the "Services" template — labour/service quotes with
  // 100% payment before the schedule of services and no production/warranty.
  servicesTerms: [
    "1. Payment : 100% full payment before the schedule of services. VAT exclusive price.",
    "We accept Cash, Dated Check, Credit Card, Debit Card and other online payments.",
    "Subject for bank clearing for check payment.",
    "2. Revisions : Any revision or alteration on the approved P.O. and/or quotation will be charged accordingly.",
    "3. Validity : Valid for one (1) week only or please verify prevailing prices.",
    "4. Cancellation : In the event of cancellation of Client's order/Purchase order for whatever reason/s not bound by AFBM. We serve the right not to refund the payment made to cover damages for materials and manpower.",
    "5. Ownership : AFBM retains ownership of all merchandise until fully paid by Buyer. In case of payment default within the period of one (1) year. AFBM reserves the right to use the product for whatever purpose at its discretion.",
  ].join("\n"),

  // Terms & conditions for KDK products (VAT-inclusive, 50/50 payment, shorter
  // production time and warranty). Used by the "KDK" quotation template.
  kdkTerms: [
    "1. Payment : 50% down payment, 50% before delivery of order. VAT inclusive price.",
    "We accept Cash, Dated Check, Credit Card, Debit Card and other online payments.",
    "Subject for bank clearing for check payment.",
    "2. Production time : 5 to 7 working days upon confirmation of P.O. & down payment. Sundays and Holidays not included.",
    "3. Delivery : Subject for bank clearing for check payment. Delivery charge not included.",
    "4. Storage fee : 30 days free of charge. Orders that exceed 30 days after the last billing statement will be charged 0.1% of the purchase order amount multiplied by exceeding number of storage days.",
    "5. Warranty : a. Six (6) months on motor except damages due to power interruption, power failure, power surge and substandard motor protector, substandard electrical practice and other user negligence.",
    "Motor supplied by customer will not be included in the said warranty.",
    "b. Client shall provide and overload protection device against power fluctuation.",
    "c. Removing or altering any stickers and labels will void warranty.",
    "d. No warranty for Acts of Nature.",
    "6. Revisions : Any revision or alteration on the approved P.O. and/or quotation will be charged accordingly.",
    "7. Validity : Valid for one (1) week only or please verify prevailing prices.",
    "8. Cancellation : In the event of cancellation of Client's order/Purchase order for whatever reason/s not bound by AFBM. We serve the right not to refund the payment made to cover damages for materials and manpower.",
    "9. Ownership : AFBM retains ownership of all merchandise until fully paid by Buyer. In case of payment default within the period of one (1) year. AFBM reserves the right to use the product for whatever purpose at its discretion.",
  ].join("\n"),

  // Terms & conditions for the "Air Terminals and Ducts" template (VAT-inclusive,
  // 50/50 payment, no warranty section).
  airTerminalsTerms: [
    "1. Payment : 50% down payment, 50% before delivery of order. VAT inclusive price.",
    "We accept Cash, Dated Check, Credit Card, Debit Card and other online payments.",
    "Subject for bank clearing for check payment.",
    "2. Production time : 7 to 10 working days upon confirmation of P.O. & down payment. Sundays and Holidays not included.",
    "3. Delivery : Subject for bank clearing for check payment. Delivery charge not included.",
    "4. Storage fee : 30 days free of charge. Orders that exceed 30 days after the last billing statement will be charged 0.1% of the purchase order amount multiplied by exceeding number of storage days.",
    "5. Revisions : Any revision or alteration on the approved P.O. and/or quotation will be charged accordingly.",
    "6. Validity : Valid for one (1) week only or please verify prevailing prices.",
    "7. Cancellation : In the event of cancellation of Client's order/Purchase order for whatever reason/s not bound by AFBM. We serve the right not to refund the payment made to cover damages for materials and manpower.",
    "8. Ownership : AFBM retains ownership of all merchandise until fully paid by Buyer. In case of payment default within the period of one (1) year. AFBM reserves the right to use the product for whatever purpose at its discretion.",
  ].join("\n"),
};
