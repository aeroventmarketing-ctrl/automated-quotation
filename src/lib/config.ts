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
};
