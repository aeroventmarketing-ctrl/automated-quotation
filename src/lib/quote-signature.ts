import { createHash } from "crypto";

/**
 * Client-independent "signature" of a quotation's line-item set, used to detect
 * duplicate RFQs quoted to different clients. Two quotes match iff they contain
 * the same products with the same specs and the same quantities — price, client,
 * dates, discount/VAT, and cosmetic wording are excluded. Order-independent.
 *
 * Identity per line = a whitelist of the defining spec fields + catalogue model +
 * quantity. (Exact match only; sizes are compared exactly.)
 */

// Defining spec fields (from specsSnapshot). Cosmetic/derived keys (itemLabel,
// bodyPrice, nested selection data) are intentionally excluded.
const IDENTITY_KEYS = [
  "category", "brand", "type", "bladeType", "drive", "material", "shape",
  "sizeL", "sizeW", "sizeUnit", "gauge", "powderCoated", "movement", "blowerModel",
  "capacity_cfm", "staticPressure_pa", "inches", "motorHp", "motorPh", "motorPole", "motorVolts",
  "ductCalcLength", "ductCalcWidth", "ductNoFlange", "mcRecommend",
  "bladeMaterialOn", "bladeMaterial", "upgradePaint", "paintType", "exproof", "customizedUnit",
  "cleatSize", "canvassUnit", "acHeight", "acHeightUnit", "acWidth", "acWidthUnit",
] as const;

function norm(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  return String(v).trim().toLowerCase();
}

export interface SigItem {
  specsSnapshot: unknown; // Prisma Json (Record<string, unknown>)
  qty: number;
  catalogueItemId?: string | null;
}

/** Canonical fingerprint of one line (product + specs + qty). The chosen model
 *  is captured by the `blowerModel` spec, so catalogueItemId is not used (it lets
 *  a live builder compute the same signature as a saved quote). */
export function lineFingerprint(item: SigItem): string {
  const s = (item.specsSnapshot ?? {}) as Record<string, unknown>;
  const parts = IDENTITY_KEYS.map((k) => `${k}=${norm(s[k])}`);
  parts.push(`qty=${item.qty}`);
  return parts.join("|");
}

/** Order-independent signature of a quote's whole line-item set ("" when empty). */
export function quoteSignature(items: SigItem[]): string {
  if (!items.length) return "";
  const lines = items.map(lineFingerprint).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 20);
}
