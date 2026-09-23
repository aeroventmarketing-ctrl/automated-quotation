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
import { TECO_SELLING, type TecoSection } from "@/lib/teco-induction-selling";
import { HYUNDAI_SELLING } from "@/lib/hyundai-induction-selling";
import { catalogueTecoPrice, catalogueHyundaiPrice, type MotorPriceMap } from "@/lib/motor-catalogue";

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
  /**
   * The catalogue price for this row's mounting, or null to use the file's.
   * Passed in rather than looked up here so this stays one function for both
   * brands — TECO and Hyundai key their catalogue codes differently.
   */
  fromCatalogue: (mounting: "foot" | "flange") => number | null = () => null,
) {
  const details = motorDetails(r.kw, r.rpm, r.frame);
  const add = (mounting: string, price: number | null, key: "foot" | "flange") => {
    // A mounting the supplier does not offer stays absent — a catalogue price
    // cannot conjure a flange-mounted motor that is not sold.
    if (price == null) return;
    price = fromCatalogue(key) ?? price;
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
  add("Foot Mounted", r.foot, "foot");
  add("Flanged Mounted", r.flange, "flange");
}

/**
 * Build the full flattened product list from the taxonomy + motor tables.
 *
 * `motorPrices` are the catalogue's, and they win where they exist — otherwise
 * this export would keep publishing the old figure after a price increase was
 * entered in Admin → Catalogue. Omitted, it behaves exactly as it always did.
 */
export function buildProductListRows(motorPrices: MotorPriceMap | null = null): ProductListRow[] {
  const rows: ProductListRow[] = [];
  for (const e of PRODUCT_TAXONOMY) {
    const brand = e.brand ?? "";
    const group = e.group ?? "";

    // Induction motors → expand to model level from the selling tables.
    if (e.category === "Other Products" && e.type === "Induction Motor (TECO)") {
      for (const [key, r] of Object.entries(TECO_SELLING)) {
        const section = key.split("|")[0];
        const phaseLabel = section === "single" ? "1-Phase" : section === "ex" ? "3-Phase Ex-Proof" : "3-Phase";
        pushMotorRows(rows, { category: e.category, brand, type: e.type }, phaseLabel, r, (m) =>
          catalogueTecoPrice(section as TecoSection, r.hp, r.pole, m, motorPrices),
        );
      }
      continue;
    }
    if (e.category === "Other Products" && e.type === "Induction Motor (Hyundai)") {
      for (const r of Object.values(HYUNDAI_SELLING)) {
        pushMotorRows(rows, { category: e.category, brand, type: e.type }, "3-Phase", r, (m) =>
          catalogueHyundaiPrice(r.hp, r.pole, m, motorPrices),
        );
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
export function buildProductListCsv(motorPrices: MotorPriceMap | null = null): string {
  const lines = [PRODUCT_LIST_HEADER.join(",")];
  for (const r of buildProductListRows(motorPrices)) {
    lines.push(
      [r.category, r.brand, r.group, r.type, r.variant, r.sku, r.sellingPrice, r.supplierPrice, r.unit, r.details]
        .map(csvCell)
        .join(","),
    );
  }
  return "﻿" + lines.join("\r\n");
}
