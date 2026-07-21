/**
 * Voucher reconciliation for a purchase request. Accounting issues a voucher
 * (cash) for the PO amount; the purchaser buys the materials and brings back
 * receipts. Instead of checking each voucher against its receipts by hand, the
 * purchaser records the actual amount paid per line and uploads the receipts,
 * and the system auto-tallies it against the PO — line by line and in total —
 * flagging change to return or an overspend.
 *
 * Payment can be VAT inclusive (prices already include VAT) or VAT exclusive
 * (12% VAT added on top), chosen per reconciliation.
 *
 * Rides in the PurchaseRequest.reconciliation JSON column (an object). For a
 * combined PO it attaches to the anchor request (the whole PO / voucher).
 */
import type { SaleDoc } from "@/lib/sale";
import type { PRStatus } from "@/lib/purchasing";
import { config } from "@/lib/config";
import { round2 } from "@/lib/quote";

export type ReconcileVatMode = "inclusive" | "exclusive";

/**
 * Map a quotation's vatMode ("INCLUSIVE" | "EXCLUSIVE" | "EXCLUSIVE_PLUS") to the
 * reconciliation's two-way VAT mode. Any EXCLUSIVE variant → "exclusive".
 */
export function quoteVatToReconcile(vatMode?: string | null): ReconcileVatMode {
  return String(vatMode ?? "").toUpperCase().startsWith("EXCLUSIVE") ? "exclusive" : "inclusive";
}

/** One PO line's expected (PO) amount vs the actual amount paid for it. */
export interface ReconcileLine {
  description: string;
  qty: string;
  poAmount: number; // PO gross line amount as priced (qty × unit price)
  actualAmount: number; // actual amount paid for this line, per the receipt
}

export interface ReconcileStamp {
  byName: string;
  role: string;
  at: string; // ISO
  note?: string;
}

export interface Reconciliation {
  vatMode?: ReconcileVatMode;
  lines?: ReconcileLine[]; // per-line actuals
  receipts?: SaleDoc[]; // uploaded receipts / official receipts
  recordedByName?: string;
  recordedRole?: string;
  recordedAt?: string; // ISO
  note?: string;
  aiReadCount?: number; // times the AI receipt reader has been run (limited)
  aiReadEscalation?: ReconcileStamp; // accounting informed the approver the AI-read limit was hit
  // Discrepancy handling (only when the tally doesn't balance):
  escalation?: ReconcileStamp; // accounting informed the approver
  approval?: ReconcileStamp; // the payment approver authorised the discrepancy
  settled?: ReconcileStamp; // change returned / overspend reimbursed
}

function coerceStamp(v: unknown): ReconcileStamp | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  return {
    byName: typeof o.byName === "string" ? o.byName : "",
    role: typeof o.role === "string" ? o.role : "",
    at: typeof o.at === "string" ? o.at : "",
    note: typeof o.note === "string" ? o.note : undefined,
  };
}

function coerceDoc(v: unknown): SaleDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || typeof o.name !== "string") return null;
  return { path: o.path, name: o.name, uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "" };
}

function coerceLine(v: unknown): ReconcileLine | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return {
    description: typeof o.description === "string" ? o.description : "",
    qty: typeof o.qty === "string" ? o.qty : String(o.qty ?? ""),
    poAmount: typeof o.poAmount === "number" ? o.poAmount : 0,
    actualAmount: typeof o.actualAmount === "number" ? o.actualAmount : 0,
  };
}

export function coerceReconciliation(v: unknown): Reconciliation {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  return {
    vatMode: o.vatMode === "exclusive" ? "exclusive" : o.vatMode === "inclusive" ? "inclusive" : undefined,
    lines: Array.isArray(o.lines) ? o.lines.map(coerceLine).filter((l): l is ReconcileLine => l !== null) : undefined,
    receipts: Array.isArray(o.receipts) ? o.receipts.map(coerceDoc).filter((d): d is SaleDoc => d !== null) : undefined,
    recordedByName: typeof o.recordedByName === "string" ? o.recordedByName : undefined,
    recordedRole: typeof o.recordedRole === "string" ? o.recordedRole : undefined,
    recordedAt: typeof o.recordedAt === "string" ? o.recordedAt : undefined,
    note: typeof o.note === "string" ? o.note : undefined,
    aiReadCount: typeof o.aiReadCount === "number" ? o.aiReadCount : undefined,
    aiReadEscalation: coerceStamp(o.aiReadEscalation),
    escalation: coerceStamp(o.escalation),
    approval: coerceStamp(o.approval),
    settled: coerceStamp(o.settled),
  };
}

/** Multiplier applied to the PO amount to get the payable under the VAT mode. */
export function vatFactor(mode: ReconcileVatMode): number {
  return mode === "exclusive" ? 1 + (config.vatRate || 0.12) : 1;
}

export type ReconcileStatus = "balanced" | "change" | "over";

/**
 * How close the total must be to count as "balanced" (and to auto-record without
 * a human). A small floor absorbs VAT/centavo rounding; it scales gently for
 * large vouchers. Anything beyond this is a discrepancy that needs the approver.
 */
export function balanceTolerance(voucherAmount: number): number {
  return Math.max(1, round2(Math.abs(voucherAmount) * 0.0005));
}

/** Compare an issued voucher against the actual spend. variance = voucher − spent. */
export function computeVariance(voucherAmount: number, actualSpent: number): { variance: number; status: ReconcileStatus } {
  const variance = round2(voucherAmount - actualSpent);
  if (Math.abs(variance) <= balanceTolerance(voucherAmount)) return { variance, status: "balanced" };
  return { variance, status: variance > 0 ? "change" : "over" };
}

/** Voucher (expected, VAT-adjusted) vs actual totals for a set of recorded lines. */
export function reconcileTotals(lines: ReconcileLine[], mode: ReconcileVatMode): { voucher: number; actual: number; variance: number; status: ReconcileStatus } {
  const f = vatFactor(mode);
  const voucher = round2(lines.reduce((a, l) => a + l.poAmount, 0) * f);
  const actual = round2(lines.reduce((a, l) => a + l.actualAmount, 0));
  const { variance, status } = computeVariance(voucher, actual);
  return { voucher, actual, variance, status };
}

/** Has the purchaser recorded the per-line actuals for this PO yet? */
export function isReconciled(r: Reconciliation): boolean {
  return Array.isArray(r.lines) && r.lines.length > 0;
}

/** A PO can be reconciled once the materials are bought (through to received). */
const RECONCILABLE_STATUSES: PRStatus[] = ["PURCHASED", "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED", "COMPLETED"];
export function canReconcileAt(status: PRStatus): boolean {
  return RECONCILABLE_STATUSES.includes(status);
}
