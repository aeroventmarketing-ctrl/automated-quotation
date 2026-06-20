/** Centralized, typed access to runtime config (env-driven, never hard-coded). */

export const config = {
  vatRate: Number(process.env.NEXT_PUBLIC_VAT_RATE ?? "0.12"),
  defaultCurrency: process.env.NEXT_PUBLIC_DEFAULT_CURRENCY ?? "PHP",
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "attachments",
};

export const COMPANY = {
  name: "Aerovent Fans and Blowers Manufacturing",
  tagline: "Industrial Fans · Blowers · Ventilation Solutions",
  address: "Philippines",
  email: "sales@aerovent.example",
  phone: "+63 (0)2 0000 0000",
};
