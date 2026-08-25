/**
 * Storefront catalogue queries (Phase B of store ⇄ ERP unification).
 *
 * Reads the SAME `CatalogueItem` records the ERP uses, filtered to the ones an
 * admin has listed (`storeListed`), and shapes them for the public store: a URL
 * slug, a display category, photos, and the DERIVED website price
 * (AeroQuote ÷ 0.95 — never stored, see `websiteSellingPrice`).
 *
 * Fabricated fans & blowers are **quote-only**: they are made to order and priced
 * by spec in a quotation, so they carry no public price and no add-to-cart —
 * their product page sends the visitor to Request a Quotation instead.
 */
import { prisma } from "@/lib/db";
import type { Family } from "@prisma/client";
import {
  storeFieldsOf,
  deriveStoreSlug,
  storeCategoryLabel,
  isQuoteOnly,
  websiteSellingPrice,
  type StorePhoto,
} from "@/lib/store-product";

/** One purchasable variant of a store product (a priced size / configuration). */
export interface StoreVariant {
  key: string; // PriceListEntry.variantKey ("default" for a single-variant item)
  label: string; // "" for the default variant, else the variant key
  aeroquotePrice: number;
  websitePrice: number;
}

export interface StoreProduct {
  id: string;
  slug: string;
  modelCode: string;
  name: string;
  family: Family;
  category: string;
  categorySlug: string;
  description: string | null;
  sizeLabel: string | null;
  uom: string;
  photos: StorePhoto[];
  /** Made-to-order — no public price, no cart; RFQ instead. */
  quoteOnly: boolean;
  variants: StoreVariant[];
  /** Cheapest website price across variants ("from" price); null when quote-only/unpriced. */
  fromPrice: number | null;
}

export interface StoreCategory {
  slug: string;
  label: string;
  count: number;
}

/** URL-safe slug for a category label — "Axial Fans" → "axial-fans". */
export function categorySlug(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

type ItemWithPrices = {
  id: string;
  family: Family;
  modelCode: string;
  name: string;
  description: string | null;
  sizeLabel: string | null;
  uom: string;
  storeListed: boolean;
  storeSlug: string | null;
  storeCategory: string | null;
  storeDescription: string | null;
  storePhotos: unknown;
  priceList: { variantKey: string; basePrice: unknown; effectiveDate: Date }[];
};

/** Shape one catalogue row into a storefront product. */
function toStoreProduct(it: ItemWithPrices): StoreProduct {
  const fields = storeFieldsOf(it);
  const quoteOnly = isQuoteOnly(it.family);
  const label = storeCategoryLabel(it.family, fields.storeCategory);

  // Latest active price per variant (the query orders newest first, so the first
  // row seen for a variant key wins).
  const byVariant = new Map<string, number>();
  for (const p of it.priceList) {
    if (byVariant.has(p.variantKey)) continue;
    const aq = Number(p.basePrice);
    if (Number.isFinite(aq) && aq > 0) byVariant.set(p.variantKey, aq);
  }
  const variants: StoreVariant[] = quoteOnly
    ? []
    : [...byVariant.entries()]
        .map(([key, aq]) => ({
          key,
          label: key === "default" || !key ? "" : key,
          aeroquotePrice: aq,
          websitePrice: websiteSellingPrice(aq),
        }))
        .sort((a, b) => a.websitePrice - b.websitePrice);

  return {
    id: it.id,
    slug: fields.storeSlug ?? deriveStoreSlug(it.modelCode),
    modelCode: it.modelCode,
    name: it.name,
    family: it.family,
    category: label,
    categorySlug: categorySlug(label),
    description: fields.storeDescription ?? it.description,
    sizeLabel: it.sizeLabel,
    uom: it.uom,
    photos: fields.storePhotos,
    quoteOnly,
    variants,
    fromPrice: variants.length ? variants[0].websitePrice : null,
  };
}

const LISTED_SELECT = {
  id: true, family: true, modelCode: true, name: true, description: true,
  sizeLabel: true, uom: true,
  storeListed: true, storeSlug: true, storeCategory: true, storeDescription: true, storePhotos: true,
  priceList: {
    where: { active: true },
    orderBy: { effectiveDate: "desc" },
    select: { variantKey: true, basePrice: true, effectiveDate: true },
  },
} as const;

/** Every product currently listed on the storefront. */
export async function listStoreProducts(): Promise<StoreProduct[]> {
  const items = await prisma.catalogueItem
    .findMany({
      where: { active: true, storeListed: true },
      orderBy: [{ family: "asc" }, { name: "asc" }],
      select: LISTED_SELECT,
    })
    .catch(() => [] as ItemWithPrices[]);
  return (items as ItemWithPrices[]).map(toStoreProduct);
}

/** The storefront's categories, with how many products each holds. */
export function storeCategories(products: StoreProduct[]): StoreCategory[] {
  const map = new Map<string, StoreCategory>();
  for (const p of products) {
    const cur = map.get(p.categorySlug);
    if (cur) cur.count++;
    else map.set(p.categorySlug, { slug: p.categorySlug, label: p.category, count: 1 });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * One listed product by its store slug. Falls back to matching the derived slug
 * so an item that has never been given an explicit slug is still reachable.
 */
export async function storeProductBySlug(slug: string): Promise<StoreProduct | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean) return null;
  const direct = await prisma.catalogueItem
    .findFirst({ where: { active: true, storeListed: true, storeSlug: clean }, select: LISTED_SELECT })
    .catch(() => null);
  if (direct) return toStoreProduct(direct as ItemWithPrices);
  // No explicit slug set — scan the listed items for a matching derived slug.
  const all = await listStoreProducts();
  return all.find((p) => p.slug === clean) ?? null;
}

/**
 * Whether a storage path is a photo of a LISTED product — the gate the public
 * image route uses, so the store's image endpoint can never be used to read
 * arbitrary objects out of the storage bucket.
 */
export async function isPublicStorePhoto(path: string): Promise<boolean> {
  const clean = (path ?? "").trim();
  if (!clean.startsWith("store/")) return false;
  const items = await prisma.catalogueItem
    .findMany({ where: { active: true, storeListed: true }, select: { storePhotos: true } })
    .catch(() => [] as { storePhotos: unknown }[]);
  for (const it of items) {
    for (const photo of storeFieldsOf({ storePhotos: it.storePhotos }).storePhotos) {
      if (photo.path === clean) return true;
    }
  }
  return false;
}
