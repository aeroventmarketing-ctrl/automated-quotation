/**
 * Website price list — catalogue items for the online store.
 *
 * Every ACTIVE catalogue item EXCEPT fabricated fans & blowers (those are made to
 * order and priced by spec in a quotation, so they don't go on the add-to-cart
 * store). Each row carries the AeroQuote selling price and the website price:
 *
 *   Website Selling Price = round(AeroQuote Selling Price ÷ 0.95)
 *
 * The ÷0.95 grosses the price up so a 5% online processing fee still nets the
 * AeroQuote price. Rounded to the nearest ₱1.
 */
import { prisma } from "@/lib/db";
import type { Family } from "@prisma/client";

/** Families that ARE fabricated fans / blowers — excluded from the store list. */
export const FABRICATED_FAN_FAMILIES: Family[] = ["AXIAL", "CENTRIFUGAL", "PROPELLER", "TUBULAR_INLINE", "CABINET"];

/** AeroQuote selling price → website selling price (5% online fee grossed up). */
export function websiteSellingPrice(aeroquotePrice: number): number {
  return Math.round(aeroquotePrice / 0.95);
}

export interface WebsitePriceRow {
  family: string;
  modelCode: string;
  name: string; // includes the variant label when not the default variant
  variant: string;
  uom: string;
  aeroquotePrice: number | null; // current catalogue price, or null if unpriced
  websitePrice: number | null; // = round(aeroquotePrice / 0.95)
}

export async function buildWebsitePriceList(): Promise<WebsitePriceRow[]> {
  const items = await prisma.catalogueItem.findMany({
    where: { active: true, family: { notIn: FABRICATED_FAN_FAMILIES } },
    orderBy: [{ family: "asc" }, { name: "asc" }],
    include: { priceList: { where: { active: true }, orderBy: { effectiveDate: "desc" } } },
  });

  const rows: WebsitePriceRow[] = [];
  for (const it of items) {
    // Latest active price per variant (a resale item usually has one "default").
    const byVariant = new Map<string, (typeof it.priceList)[number]>();
    for (const p of it.priceList) if (!byVariant.has(p.variantKey)) byVariant.set(p.variantKey, p);
    const priced = [...byVariant.values()];

    if (priced.length === 0) {
      rows.push({ family: it.family, modelCode: it.modelCode, name: it.name, variant: "", uom: it.uom, aeroquotePrice: null, websitePrice: null });
      continue;
    }
    for (const p of priced) {
      const aq = Number(p.basePrice);
      const isDefault = p.variantKey === "default" || !p.variantKey;
      rows.push({
        family: it.family,
        modelCode: it.modelCode,
        name: isDefault ? it.name : `${it.name} (${p.variantKey})`,
        variant: isDefault ? "" : p.variantKey,
        uom: it.uom,
        aeroquotePrice: aq,
        websitePrice: Number.isFinite(aq) ? websiteSellingPrice(aq) : null,
      });
    }
  }
  return rows;
}

/** RFC-4180 CSV of the website price list, ready to download / feed the store. */
export function websitePriceListCsv(rows: WebsitePriceRow[]): string {
  const esc = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Category", "Model Code", "Name", "Variant", "UoM", "AeroQuote Selling Price", "Website Selling Price"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([r.family, r.modelCode, r.name, r.variant, r.uom, r.aeroquotePrice ?? "", r.websitePrice ?? ""].map(esc).join(","));
  }
  return "﻿" + lines.join("\n"); // BOM so Excel reads UTF-8
}
