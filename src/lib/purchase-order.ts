/**
 * Supplier Purchase Order — the document the purchaser sends to a supplier to
 * order materials. It rides in the PurchaseRequest.po JSON column. Totals mirror
 * AeroVent's paper PO: gross total, LESS EWT 1% (computed on the VAT-exclusive
 * amount, i.e. gross / (1 + VAT) × rate), and the net amount payable.
 */
import { config, COMPANY } from "@/lib/config";
import { round2 } from "@/lib/quote";
import { specDetailFor } from "@/lib/department-pnl";

export interface POLine {
  description: string;
  qty: string;
  unit: string;
  unitPrice: string;
}

export interface POSupplier {
  company: string;
  attention: string;
  address: string;
}

export type EwtMode = "percent" | "amount";

export interface PurchaseOrder {
  poNumber: string; // e.g. "PO-AFBM20260000503"
  date: string; // ISO date the PO was dated
  supplier: POSupplier;
  lines: POLine[];
  ewtPct: number; // Expanded Withholding Tax %, default 1 (used when ewtMode = "percent")
  ewtMode: EwtMode; // how EWT is computed: by percent of the VAT-exclusive amount, or a flat amount
  ewtAmount: number; // flat EWT amount (used when ewtMode = "amount")
  remarks: string;
  createdByName: string;
  createdAt: string; // ISO timestamp
}

/** PO number: PO-AFBM<year><7-digit sequence>, e.g. PO-AFBM20260000503. */
export function formatPoNumber(seq: number, year: number): string {
  return `PO-${COMPANY.quotePrefix}${year}${String(seq).padStart(7, "0")}`;
}

const num = (s: string): number => {
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/** Gross amount of one line (qty × unit price). */
export function poLineAmount(line: POLine): number {
  return round2(num(line.qty) * num(line.unitPrice));
}

export interface POTotals {
  total: number; // sum of gross line amounts
  ewt: number; // LESS EWT — on the VAT-exclusive amount
  net: number; // net amount payable
}

/**
 * Compute the PO totals. EWT is either a percent of the VAT-exclusive portion
 * (ewtMode "percent", the default) or a flat amount (ewtMode "amount").
 */
export function poTotals(po: { lines: POLine[]; ewtPct?: number; ewtMode?: EwtMode; ewtAmount?: number }): POTotals {
  const total = round2(po.lines.reduce((a, l) => a + poLineAmount(l), 0));
  const vatRate = config.vatRate || 0.12;
  const exVat = total / (1 + vatRate);
  const ewt = po.ewtMode === "amount"
    ? round2(po.ewtAmount || 0)
    : round2(exVat * ((po.ewtPct || 0) / 100));
  const net = round2(total - ewt);
  return { total, ewt, net };
}

/** Does this PO withhold any EWT? (drives whether the "LESS EWT" row shows.) */
export function poHasEwt(po: { ewtPct?: number; ewtMode?: EwtMode; ewtAmount?: number }): boolean {
  return po.ewtMode === "amount" ? (po.ewtAmount || 0) > 0 : (po.ewtPct || 0) > 0;
}

/** The "LESS EWT" row label — "LESS EWT 1%" for percent, plain "LESS EWT" for a flat amount. */
export function poEwtLabel(po: { ewtPct?: number; ewtMode?: EwtMode }): string {
  return po.ewtMode === "amount" ? "LESS EWT" : `LESS EWT ${po.ewtPct ?? 0}%`;
}

/** Coerce arbitrary JSON (PurchaseRequest.po) into a PurchaseOrder, or null. */
export function coercePurchaseOrder(value: unknown): PurchaseOrder | null {
  if (!value || typeof value !== "object") return null;
  const o = value as Record<string, unknown>;
  if (!o.poNumber) return null;
  const s = (o.supplier ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(o.lines)
    ? o.lines.map((l): POLine => {
        const r = (l ?? {}) as Record<string, unknown>;
        return {
          description: String(r.description ?? ""),
          qty: String(r.qty ?? ""),
          unit: String(r.unit ?? ""),
          unitPrice: String(r.unitPrice ?? ""),
        };
      })
    : [];
  return {
    poNumber: String(o.poNumber),
    date: String(o.date ?? ""),
    supplier: {
      company: String(s.company ?? ""),
      attention: String(s.attention ?? ""),
      address: String(s.address ?? ""),
    },
    lines,
    ewtPct: Number.isFinite(Number(o.ewtPct)) ? Number(o.ewtPct) : 1,
    ewtMode: o.ewtMode === "amount" ? "amount" : "percent",
    ewtAmount: Number.isFinite(Number(o.ewtAmount)) ? Number(o.ewtAmount) : 0,
    remarks: String(o.remarks ?? ""),
    createdByName: String(o.createdByName ?? ""),
    createdAt: String(o.createdAt ?? ""),
  };
}

/**
 * Turn a stored purchase-request line into a PO line. PR items are display
 * strings like "6 pc · BELT B-65 (spare)" — split off the leading "<qty> <unit>"
 * so the purchaser only has to fill the unit price. Falls back to putting the
 * whole string in the description when it doesn't match that shape.
 */
export function poLineFromPRItem(item: string): POLine {
  const raw0 = String(item ?? "").trim();
  // Pull off an optional trailing " · @<price>" (a supplier grid price the
  // requisition carried) so the PO line auto-fills its unit price.
  const pm = raw0.match(PO_PRICE_MARKER);
  const unitPrice = pm ? pm[1].replace(/,/g, "") : "";
  const raw = pm ? raw0.replace(PO_PRICE_MARKER, "").trim() : raw0;
  const parts = raw.split(" · ");
  if (parts.length >= 2) {
    const qtyUnit = parts[0].trim();
    const description = parts.slice(1).join(" · ").trim();
    const m = qtyUnit.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (m) return { description, qty: m[1], unit: m[2], unitPrice };
    return { description, qty: "", unit: qtyUnit, unitPrice };
  }
  return { description: raw, qty: "", unit: "", unitPrice };
}

/**
 * Sentinel prefix marking a requisition line that was already issued from stock.
 * The line is kept on the requisition as an "Issued X from stock" record, but it
 * must never be turned into a Purchase Order line — it's informational only.
 */
export const ISSUED_FROM_STOCK_PREFIX = "✓ issued from stock · ";

export function isIssuedFromStockLine(item: string): boolean {
  return String(item ?? "").startsWith(ISSUED_FROM_STOCK_PREFIX);
}

/** Format the record line stored on a requisition when a line is issued from stock. */
export function issuedFromStockLine(issued: number | string, unit: string, desc: string): string {
  const head = unit ? `${issued} ${unit}` : String(issued);
  return `${ISSUED_FROM_STOCK_PREFIX}${head} · ${desc}`;
}

/** Read back an issued-from-stock record line into its parts (null if not one). */
export function parseIssuedFromStockLine(item: string): { qty: string; unit: string; desc: string } | null {
  if (!isIssuedFromStockLine(item)) return null;
  const body = item.slice(ISSUED_FROM_STOCK_PREFIX.length).trim();
  const dot = body.indexOf(" · ");
  const head = dot >= 0 ? body.slice(0, dot).trim() : "";
  const desc = dot >= 0 ? body.slice(dot + 3).trim() : body;
  const m = head.match(/^([\d.]+)\s+(.*)$/);
  return { qty: m ? m[1] : head, unit: m ? m[2].trim() : "", desc };
}

/**
 * Sentinel prefix marking a requisition line the warehouse explicitly sent to
 * purchasing (the MRF's "To purchasing" action). Unlike an issued record this is
 * still bought — the prefix is stripped before the PO line is built — it just
 * carries a "To purchase" badge so the line reads as handled.
 */
export const TO_PURCHASE_PREFIX = "» to purchase · ";

export function isToPurchaseLine(item: string): boolean {
  return String(item ?? "").startsWith(TO_PURCHASE_PREFIX);
}

/** Drop the "to purchase" marker, leaving the plain "qty unit · desc" line. */
export function stripToPurchasePrefix(item: string): string {
  return isToPurchaseLine(item) ? item.slice(TO_PURCHASE_PREFIX.length) : item;
}

/** Mark a line as explicitly sent to purchasing (idempotent). */
export function toPurchaseLine(item: string): string {
  return `${TO_PURCHASE_PREFIX}${stripToPurchasePrefix(item)}`;
}

/**
 * Build PO lines from PR item strings: skip already-issued-from-stock records
 * (informational only) and strip the "to purchase" marker off the rest so the
 * purchaser sees a clean "qty unit · desc" line.
 */
export function poLinesFromPRItems(items: string[]): POLine[] {
  return (Array.isArray(items) ? items : [])
    .filter((s) => !isIssuedFromStockLine(s))
    .map((s) => poLineFromPRItem(stripToPurchasePrefix(s)));
}

/**
 * Optional trailing " · @<price>" a requisition can carry (a supplier grid price,
 * e.g. from the Wind Driven Roof Ventilator size × material grid) so the PO
 * auto-fills the unit price. Informational only — stripped from text previews.
 */
const PO_PRICE_MARKER = /\s*·\s*@\s*([\d,]+(?:\.\d+)?)\s*$/;
export function stripPoPriceMarker(item: string): string {
  return String(item ?? "").replace(PO_PRICE_MARKER, "").trim();
}

/**
 * Requisition item lines with the quotation's specification folded in.
 *
 * Applied when READING a purchase request, so an order raised before the
 * generator carried the spec still reads — and prints on its PO — the way the
 * quotation does. Deriving it here rather than migrating stored rows covers
 * every existing order at once, and the PO's default lines (built from these
 * same strings) pick the spec up too.
 *
 * The spec goes in BEFORE any trailing " · @<price>" marker, which is anchored
 * to the end of the string — appending after it would strand the supplier grid
 * price and the PO would stop auto-filling.
 */
export function withSpecDetail(items: string[], specs: { name: string; detail: string[] }[]): string[] {
  if (specs.length === 0) return items;
  return items.map((it) => {
    const missing = specDetailFor(it, specs);
    if (missing.length === 0) return it;
    const pm = it.match(PO_PRICE_MARKER);
    const body = pm ? it.replace(PO_PRICE_MARKER, "") : it;
    return [body, ...missing].join(" · ") + (pm ? pm[0] : "");
  });
}

/** Clean PR item lines for a text preview: drop issued records, strip the "to purchase" + price markers. */
export function displayPRItems(items: string[]): string[] {
  return (Array.isArray(items) ? items : []).filter((s) => !isIssuedFromStockLine(s)).map((s) => stripPoPriceMarker(stripToPurchasePrefix(s)));
}
