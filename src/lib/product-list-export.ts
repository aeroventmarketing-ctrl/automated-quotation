/**
 * Full product-list worksheet — every entry in the quotation product taxonomy
 * (the Category → Brand/Group → Type dropdowns), flattened to one row per
 * sellable item, as the master worksheet for assigning SKUs and prices.
 *
 * Most types are emitted at family level (one row); a type that carries a
 * `series` (e.g. KDK Wall Mounted Fan → Shutter / High Pressure) expands to one
 * row per series. Induction Motors are expanded to MODEL level from the selling
 * tables already in the system (TECO / Hyundai — one row per phase / HP / pole /
 * mounting, with the known net selling price). Supplier price and SKU are left
 * blank for the owner to fill; unknown selling prices (everything except the
 * induction motors) are blank too.
 */
import { PRODUCT_TAXONOMY } from "@/lib/product-taxonomy";
import { TECO_SELLING } from "@/lib/teco-induction-selling";
import { HYUNDAI_SELLING } from "@/lib/hyundai-induction-selling";

export interface ProductListRow {
  category: string;
  brand: string;
  group: string;
  type: string;
  /** Series name or expanded motor model descriptor; blank for plain types. */
  variant: string;
  /** Item Code — blank, to be filled in. */
  sku: string;
  /** Net (VAT-exclusive) selling price when known (induction motors), else blank. */
  sellingPrice: string;
  /** Supplier cost — blank, to be filled in. */
  supplierPrice: string;
  unit: string;
  /** Free-text spec detail (kW · rpm · frame) for motors; blank otherwise. */
  details: string;
}

function motorDetails(kw: number | null, rpm: number | null, frame: string): string {
  return [kw != null ? `${kw}kW` : "", rpm != null ? `${rpm}rpm` : "", frame ? `frame ${frame}` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** Push the foot- and (when priced) flange-mounted rows for one motor model. */
function pushMotorRows(
  rows: ProductListRow[],
  base: { category: string; brand: string; type: string },
  phaseLabel: string,
  r: { hp: number; pole: number; kw: number | null; rpm: number | null; frame: string; foot: number; flange: number | null },
) {
  const details = motorDetails(r.kw, r.rpm, r.frame);
  const add = (mounting: string, price: number | null) => {
    if (price == null) return;
    rows.push({
      category: base.category,
      brand: base.brand,
      group: "",
      type: base.type,
      variant: `${phaseLabel} ${String(r.hp)}HP ${r.pole}-Pole · ${mounting}`,
      sku: "",
      sellingPrice: String(price),
      supplierPrice: "",
      unit: "pc",
      details,
    });
  };
  add("Foot Mounted", r.foot);
  add("Flanged Mounted", r.flange);
}

/** Build the full flattened product list from the taxonomy + motor tables. */
export function buildProductListRows(): ProductListRow[] {
  const rows: ProductListRow[] = [];
  for (const e of PRODUCT_TAXONOMY) {
    const brand = e.brand ?? "";
    const group = e.group ?? "";

    // Induction motors → expand to model level from the selling tables.
    if (e.category === "Other Products" && e.type === "Induction Motor (TECO)") {
      for (const [key, r] of Object.entries(TECO_SELLING)) {
        const section = key.split("|")[0];
        const phaseLabel = section === "single" ? "1-Phase" : section === "ex" ? "3-Phase Ex-Proof" : "3-Phase";
        pushMotorRows(rows, { category: e.category, brand, type: e.type }, phaseLabel, r);
      }
      continue;
    }
    if (e.category === "Other Products" && e.type === "Induction Motor (Hyundai)") {
      for (const r of Object.values(HYUNDAI_SELLING)) {
        pushMotorRows(rows, { category: e.category, brand, type: e.type }, "3-Phase", r);
      }
      continue;
    }

    // A type with a series → one row per series; otherwise a single family row.
    const variants = e.series && e.series.length > 0 ? e.series : [""];
    for (const v of variants) {
      rows.push({
        category: e.category,
        brand,
        group,
        type: e.type,
        variant: v,
        sku: "",
        sellingPrice: "",
        supplierPrice: "",
        unit: "pc",
        details: "",
      });
    }
  }
  return rows;
}

/** Escape one CSV cell (quote when it holds a comma / quote / newline). */
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const PRODUCT_LIST_HEADER = [
  "category",
  "brand",
  "group",
  "type",
  "variant_or_model",
  "sku",
  "selling_price_net",
  "supplier_price",
  "unit",
  "details",
] as const;

/** Render the full product list as a UTF-8 CSV string (with BOM for Excel). */
export function buildProductListCsv(): string {
  const lines = [PRODUCT_LIST_HEADER.join(",")];
  for (const r of buildProductListRows()) {
    lines.push(
      [r.category, r.brand, r.group, r.type, r.variant, r.sku, r.sellingPrice, r.supplierPrice, r.unit, r.details]
        .map(csvCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n");
}
