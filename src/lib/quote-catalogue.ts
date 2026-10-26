/**
 * The fan catalogue as the quotation builder uses it — cached across requests.
 *
 * ## Why
 *
 * The quotation page read every active `CatalogueItem` with its whole `specs`
 * JSON and description, plus its default price, on every render — and the page
 * auto-refreshes, and every save re-renders it. The owner's `pg_stat_statements`
 * (26 Oct): **32,115 calls × 598 rows** for the catalogue and **32,151 × 596**
 * for its prices — about 38 million rows at roughly 500 bytes each, the largest
 * single reader in the database. The catalogue changes when an admin edits or
 * imports it, a few times a month.
 *
 * ## How it stays right
 *
 * Every write path calls `revalidateQuoteCatalogue()`: `upsertCatalogueItem`,
 * `seedMotorCatalogue`, `deleteCatalogueItem`, `clearCatalogue` and the CSV
 * catalogue / price-list import. A change made OUTSIDE the app (SQL in the
 * Supabase editor) is picked up within `revalidate` seconds.
 *
 * The cached value is the small, already-shaped map the builder is handed —
 * numbers and strings only, no Prisma `Decimal` — which is what makes it safe
 * through Next's data cache.
 */
import { unstable_cache, revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";

export const QUOTE_CATALOGUE_TAG = "catalogue:fans";

export interface QuoteCatalogEntry {
  modelCode: string;
  description: string;
  basePrice: number;
  bladeDia: number | null;
  // Air-curtain attributes (used to pick a model by height + door width).
  type: string | null;
  lengthMm: number | null;
  heightM: number | null;
  powerW: number | null;
  airVolumeCmh: number | null;
}

/** Drop the cached catalogue (and the motor prices read from it). Call after any catalogue write. */
export function revalidateQuoteCatalogue(): void {
  revalidateTag(QUOTE_CATALOGUE_TAG);
}

const num = (v: unknown): number | null => (typeof v === "number" && !Number.isNaN(v) ? v : null);

/** Shape one catalogue row — exported for the test. */
export function toQuoteCatalogEntry(i: {
  modelCode: string;
  description: string | null;
  specs: unknown;
  priceList: { basePrice: unknown }[];
}): QuoteCatalogEntry {
  const s = (i.specs ?? null) as Record<string, unknown> | null;
  return {
    modelCode: i.modelCode,
    description: i.description ?? "",
    basePrice: i.priceList[0] ? Number(i.priceList[0].basePrice) : 0,
    bladeDia: num(s?.bladeDia_in),
    type: typeof s?.type === "string" ? (s.type as string) : null,
    lengthMm: num(s?.length_mm),
    heightM: num(s?.effectiveHeight_m),
    powerW: num(s?.power_w),
    airVolumeCmh: num(s?.airVolume_cmh),
  };
}

export const getQuoteCatalog = unstable_cache(
  async (): Promise<Record<string, QuoteCatalogEntry>> => {
    const items = await prisma.catalogueItem.findMany({
      where: { active: true },
      select: {
        id: true,
        modelCode: true,
        description: true,
        specs: true,
        priceList: { where: { variantKey: "default" }, take: 1, select: { basePrice: true } },
      },
    });
    return Object.fromEntries(items.map((i) => [i.id, toQuoteCatalogEntry(i)]));
  },
  ["quote-catalog-v1"],
  { tags: [QUOTE_CATALOGUE_TAG], revalidate: 300 },
);
