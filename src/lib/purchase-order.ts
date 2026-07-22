/**
 * Supplier Purchase Order — the document the purchaser sends to a supplier to
 * order materials. It rides in the PurchaseRequest.po JSON column. Totals mirror
 * AeroVent's paper PO: gross total, LESS EWT 1% (computed on the VAT-exclusive
 * amount, i.e. gross / (1 + VAT) × rate), and the net amount payable.
 */
import { config, COMPANY } from "@/lib/config";
import { round2 } from "@/lib/quote";

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
  const raw = String(item ?? "").trim();
  const parts = raw.split(" · ");
  if (parts.length >= 2) {
    const qtyUnit = parts[0].trim();
    const description = parts.slice(1).join(" · ").trim();
    const m = qtyUnit.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (m) return { description, qty: m[1], unit: m[2], unitPrice: "" };
    return { description, qty: "", unit: qtyUnit, unitPrice: "" };
  }
  return { description: raw, qty: "", unit: "", unitPrice: "" };
}
