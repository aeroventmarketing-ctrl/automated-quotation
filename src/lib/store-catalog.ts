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
import { stockForCatalogue, stockForCatalogueMany } from "@/lib/store-stock";
import { getStoreTheme } from "@/lib/store-theme";

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
  /** No public price and no cart — RFQ instead (true whenever the item is unpriced). */
  quoteOnly: boolean;
  /**
   * The item belongs to a fabricated-fan family. Used only for WORDING: an
   * unpriced fabricated fan is "made to order, quoted by specification", while
   * any other unpriced item is simply "price on request".
   */
  fabricated: boolean;
  variants: StoreVariant[];
  /** Cheapest website price across variants ("from" price); null when quote-only/unpriced. */
  fromPrice: number | null;
  /**
   * Free-to-issue stock. `null` means the item isn't tracked in inventory at
   * all, which counts as sellable — only a tracked item at 0 is out of stock.
   */
  available: number | null;
}

/** Sellable right now: quote-only items never are; untracked items always are. */
export function inStock(p: Pick<StoreProduct, "quoteOnly" | "available">): boolean {
  if (p.quoteOnly) return false;
  return p.available == null || p.available > 0;
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

/** Shape one catalogue row into a storefront product. `available` is filled in by the caller. */
function toStoreProduct(it: ItemWithPrices, available: number | null = null): StoreProduct {
  const fields = storeFieldsOf(it);
  const label = storeCategoryLabel(it.family, fields.storeCategory);

  // Latest active price per variant (the query orders newest first, so the first
  // row seen for a variant key wins).
  const byVariant = new Map<string, number>();
  for (const p of it.priceList) {
    if (byVariant.has(p.variantKey)) continue;
    const aq = Number(p.basePrice);
    if (Number.isFinite(aq) && aq > 0) byVariant.set(p.variantKey, aq);
  }
  const variants: StoreVariant[] = [...byVariant.entries()]
    .map(([key, aq]) => ({
      key,
      label: key === "default" || !key ? "" : key,
      aeroquotePrice: aq,
      websitePrice: websiteSellingPrice(aq),
    }))
    .sort((a, b) => a.websitePrice - b.websitePrice);

  // Sellability follows the PRICE, not the family. `family` says what KIND of fan
  // this is; it can't say whether we fabricate it or buy it in — a branded
  // Östberg / KDK inline fan is a TUBULAR_INLINE by type but a resale product
  // commercially. So a listed item with a catalogue price gets a cart, and one
  // without shows "Quote on request". Listing is an explicit admin action, so
  // nothing reaches the store by accident. `isQuoteOnly(family)` still decides
  // the *default* wording for an unpriced fabricated fan.
  const quoteOnly = variants.length === 0;

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
    fabricated: isQuoteOnly(it.family),
    variants,
    fromPrice: variants.length ? variants[0].websitePrice : null,
    available,
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

/** Every product currently listed on the storefront, with live availability. */
export async function listStoreProducts(): Promise<StoreProduct[]> {
  const items = (await prisma.catalogueItem
    .findMany({
      where: { active: true, storeListed: true },
      orderBy: [{ family: "asc" }, { name: "asc" }],
      select: LISTED_SELECT,
    })
    .catch(() => [] as ItemWithPrices[])) as ItemWithPrices[];
  // One inventory read for the whole list (not one per product).
  const stock = await stockForCatalogueMany(items.map((it) => ({ modelCode: it.modelCode, name: it.name })));
  return items.map((it) => toStoreProduct(it, stock.get(it.modelCode)?.available ?? null));
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
  if (direct) {
    const it = direct as ItemWithPrices;
    const info = await stockForCatalogue(it.modelCode, it.name);
    return toStoreProduct(it, info?.available ?? null);
  }
  // No explicit slug set — scan the listed items for a matching derived slug.
  const all = await listStoreProducts();
  return all.find((p) => p.slug === clean) ?? null;
}

/**
 * Whether a storage path is one the public store is allowed to serve — the gate
 * the public image route uses, so the store's image endpoint can never be used
 * to read arbitrary objects out of the storage bucket.
 *
 * Two things qualify: a photo of a LISTED product, and the shop's own branding
 * (the logo and the hero image an admin set in Admin → Storefront). The theme's
 * images are as public as the shop itself — they are on every page — but they
 * belong to no product, so without this an uploaded logo would 404 for
 * shoppers and only an image smuggled in as some listed item's photo would
 * display.
 */
export async function isPublicStorePhoto(path: string): Promise<boolean> {
  const clean = (path ?? "").trim();
  if (!clean.startsWith("store/")) return false;
  return (await publicPhotoPaths()).has(clean);
}

/**
 * The set of paths the storefront may serve, cached briefly in-process. Every
 * <img> on the storefront hits the image route, and without this each one costs
 * its own database scan — the shop's hottest path. A short TTL means a newly
 * published photo appears within a minute.
 */
let photoCache: { at: number; paths: Set<string> } | null = null;
const PHOTO_CACHE_MS = 60_000;

/**
 * Drop the cached allowlist — called when the theme's branding changes, so an
 * admin who has just attached a logo sees it rather than a minute of 404s (which
 * the image route asks browsers to cache, making the wait feel longer than it
 * is). Only clears the instance that handled the save; elsewhere the TTL does
 * it, exactly as for a newly published product photo.
 */
export function forgetPublicPhotoPaths(): void {
  photoCache = null;
}

async function publicPhotoPaths(): Promise<Set<string>> {
  const now = Date.now();
  if (photoCache && now - photoCache.at < PHOTO_CACHE_MS) return photoCache.paths;

  const [items, theme] = await Promise.all([
    prisma.catalogueItem
      .findMany({ where: { active: true, storeListed: true }, select: { storePhotos: true } })
      .catch(() => [] as { storePhotos: unknown }[]),
    getStoreTheme().catch(() => null),
  ]);
  const paths = new Set<string>();
  for (const it of items) {
    for (const photo of storeFieldsOf({ storePhotos: it.storePhotos }).storePhotos) paths.add(photo.path);
  }
  for (const branding of [theme?.logoUrl, theme?.heroImagePath]) {
    const clean = (branding ?? "").trim();
    if (clean.startsWith("store/")) paths.add(clean);
  }
  photoCache = { at: now, paths };
  return paths;
}
