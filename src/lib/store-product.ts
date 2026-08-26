/**
 * Store product helpers (Phase A of store ⇄ ERP unification).
 *
 * One catalogue item drives both the ERP and the storefront. These helpers turn a
 * catalogue item's raw store columns into the shape the storefront needs — a URL
 * slug, a display category, a photo list — and centralize the fabricated-fans =
 * quote-only rule. The website price stays derived from the AeroQuote price
 * (`websiteSellingPrice`), never stored.
 */
import type { Family } from "@prisma/client";
import { FABRICATED_FAN_FAMILIES, websiteSellingPrice } from "@/lib/website-price-list";

export { websiteSellingPrice };

/**
 * Peso formatting for every storefront price. Lives here rather than beside a
 * component so server pages, client components and the RFQ/AI copy all format
 * the same way.
 */
export const peso = (n: number): string =>
  `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Human display label for a family, used as the default store category. */
const FAMILY_LABEL: Partial<Record<Family, string>> = {
  AXIAL: "Axial Fans",
  CENTRIFUGAL: "Centrifugal Blowers",
  PROPELLER: "Propeller Fans",
  TUBULAR_INLINE: "Tubular / Inline Fans",
  CABINET: "Cabinet Fans",
};

/** The store category for an item — the explicit override, else a family label. */
export function storeCategoryLabel(family: Family, override?: string | null): string {
  const o = (override ?? "").trim();
  if (o) return o;
  return FAMILY_LABEL[family] ?? String(family);
}

/**
 * Fabricated fans & blowers are made to order and priced by spec in a quotation,
 * so they are QUOTE-ONLY on the store (no add-to-cart / no public price) — the
 * standing rule, mirrored from the website price list's exclusion set.
 */
export function isQuoteOnly(family: Family): boolean {
  return FABRICATED_FAN_FAMILIES.includes(family);
}

/** A URL-safe slug from the model code (stable, unique) — e.g. "TAF-630-BELT" → "taf-630-belt". */
export function deriveStoreSlug(modelCode: string): string {
  return modelCode
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** One store photo reference stored in `CatalogueItem.storePhotos` (a JSON array). */
export interface StorePhoto {
  path: string; // storage path / URL
  alt?: string;
}

/** Coerce the raw `storePhotos` JSON into a clean StorePhoto[]. */
export function coerceStorePhotos(value: unknown): StorePhoto[] {
  if (!Array.isArray(value)) return [];
  const out: StorePhoto[] = [];
  for (const v of value) {
    if (v && typeof v === "object" && typeof (v as { path?: unknown }).path === "string") {
      const path = (v as { path: string }).path.trim();
      const altRaw = (v as { alt?: unknown }).alt;
      if (path) out.push({ path, ...(typeof altRaw === "string" && altRaw.trim() ? { alt: altRaw.trim() } : {}) });
    } else if (typeof v === "string" && v.trim()) {
      out.push({ path: v.trim() });
    }
  }
  return out;
}

/** The catalogue-item columns the store cares about (the subset A2's UI edits). */
export interface StoreFields {
  storeListed: boolean;
  storeSlug: string | null;
  storeCategory: string | null;
  storeDescription: string | null;
  storePhotos: StorePhoto[];
}

/** Read the store fields off a catalogue item (defensive; used by the store + admin). */
export function storeFieldsOf(item: {
  storeListed?: boolean | null;
  storeSlug?: string | null;
  storeCategory?: string | null;
  storeDescription?: string | null;
  storePhotos?: unknown;
}): StoreFields {
  return {
    storeListed: item.storeListed === true,
    storeSlug: item.storeSlug?.trim() || null,
    storeCategory: item.storeCategory?.trim() || null,
    storeDescription: item.storeDescription?.trim() || null,
    storePhotos: coerceStorePhotos(item.storePhotos),
  };
}
