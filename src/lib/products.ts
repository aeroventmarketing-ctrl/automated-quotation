/**
 * Product/item catalogue types. A product can be sourced from several suppliers,
 * each with its own supplier code and unit price. Suppliers are referenced by the
 * AppSetting supplier id + a denormalised company name (suppliers have no table).
 */
export interface ProductSupplierLink {
  supplierId: string;
  company: string;
  code?: string; // the supplier's own product code
  price?: number; // the supplier's unit price
}

/** Coerce arbitrary JSON (Product.suppliers) into clean supplier links. */
export function coerceProductSuppliers(value: unknown): ProductSupplierLink[] {
  if (!Array.isArray(value)) return [];
  const out: ProductSupplierLink[] = [];
  for (const r of value) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const company = String(o.company ?? "").trim();
    if (!company) continue;
    const priceRaw = o.price;
    const price =
      typeof priceRaw === "number" ? priceRaw : priceRaw != null && priceRaw !== "" ? Number(priceRaw) || undefined : undefined;
    out.push({
      supplierId: String(o.supplierId ?? "").trim(),
      company,
      code: o.code ? String(o.code).trim() : undefined,
      price: price && price > 0 ? price : undefined,
    });
  }
  return out;
}
