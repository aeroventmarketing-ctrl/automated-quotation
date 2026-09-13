import { describe, it, expect } from "vitest";
import type { Family } from "@prisma/client";
import { navCategoriesFrom, storeCategories, categorySlug, type StoreProduct } from "./store-catalog";
import { storeCategoryLabel } from "./store-product";

/**
 * The storefront nav used to be built from `storeCategories(await
 * listStoreProducts())` — the whole catalogue, every product's photos and
 * prices, and the entire inventory, to draw a menu. On the pages with no product
 * grid at all (`/store/cart`, `/store/checkout`, `/store/order/<n>`) that read
 * bought nothing else whatsoever.
 *
 * `storeNavCategories` reads two columns instead. The saving is only safe while
 * it produces **exactly** what the fuller path produced, so this asserts the two
 * against each other rather than trusting them to stay in step. Change either
 * grouping and this fails.
 */

/** A product as the full path would shape it, from the same two fields. */
const productFrom = (family: Family, storeCategory: string | null): StoreProduct => {
  const label = storeCategoryLabel(family, storeCategory);
  return {
    id: "x", slug: "x", modelCode: "X", name: "X", family,
    category: label, categorySlug: categorySlug(label),
    description: null, sizeLabel: null, uom: "unit", photos: [],
    quoteOnly: false, fabricated: false, variants: [], fromPrice: null, available: null,
  };
};

const ROWS: { family: Family; storeCategory: string | null }[] = [
  // Same family, no override — one category, counted twice.
  { family: "AXIAL" as Family, storeCategory: null },
  { family: "AXIAL" as Family, storeCategory: null },
  // An admin override wins over the family label.
  { family: "AXIAL" as Family, storeCategory: "Industrial Extractors" },
  // A different family.
  { family: "CENTRIFUGAL" as Family, storeCategory: null },
  // Whitespace and case: these must fold to the same slug as the line above it.
  { family: "CENTRIFUGAL" as Family, storeCategory: "  Industrial Extractors  " },
  { family: "PROPELLER" as Family, storeCategory: null },
];

describe("the cheap nav categories match the full ones", () => {
  it("same slugs, labels, counts and order", () => {
    const cheap = navCategoriesFrom(ROWS);
    const full = storeCategories(ROWS.map((r) => productFrom(r.family, r.storeCategory)));
    expect(cheap).toEqual(full);
  });

  it("is not vacuous — the fixture really does group and really does count", () => {
    const cheap = navCategoriesFrom(ROWS);
    expect(cheap.length).toBeGreaterThan(1);
    expect(cheap.some((c) => c.count > 1)).toBe(true);
    // The trimmed override folds together with the untrimmed one.
    const extractors = cheap.find((c) => c.slug === categorySlug("Industrial Extractors"));
    expect(extractors?.count).toBe(2);
  });

  it("an empty shop yields an empty nav, not a crash", () => {
    expect(navCategoriesFrom([])).toEqual([]);
    expect(navCategoriesFrom([])).toEqual(storeCategories([]));
  });

  it("an override of only whitespace falls back to the family label", () => {
    // `storeFieldsOf` trims to null, so this must land in the family's category
    // rather than creating a blank-slugged one.
    const cheap = navCategoriesFrom([{ family: "AXIAL" as Family, storeCategory: "   " }]);
    expect(cheap).toHaveLength(1);
    expect(cheap[0].slug).not.toBe("");
    expect(cheap).toEqual(storeCategories([productFrom("AXIAL" as Family, null)]));
  });
});
