/**
 * Voucher reconciliation for a purchase request. Accounting issues a voucher
 * (cash) for the PO amount; the purchaser buys the materials and brings back
 * receipts. Instead of checking each voucher against its receipts by hand, the
 * purchaser records the actual amount spent and uploads the receipts, and the
 * system auto-tallies it against the issued voucher — flagging change to return
 * or an overspend.
 *
 * Rides in the PurchaseRequest.reconciliation JSON column (an object). For a
 * combined PO it attaches to the anchor request (the whole PO / voucher).
 */
import type { SaleDoc } from "@/lib/sale";
import type { PRStatus } from "@/lib/purchasing";
import { round2 } from "@/lib/quote";

/** A PO can be reconciled once the materials are bought (through to received). */
const RECONCILABLE_STATUSES: PRStatus[] = ["PURCHASED", "CHECKED", "DELIVERED", "RECEIVED", "PLANT_APPROVED", "COMPLETED"];
export function canReconcileAt(status: PRStatus): boolean {
  return RECONCILABLE_STATUSES.includes(status);
}

export interface ReconcileSettlement {
  byName: string;
  role: string;
  at: string; // ISO
  note?: string;
}

export interface Reconciliation {
  voucherAmount?: number; // cash issued (defaulted from the PO total at record time)
  actualSpent?: number; // actual total per the receipts
  receipts?: SaleDoc[]; // uploaded receipts / official receipts
  recordedByName?: string;
  recordedRole?: string;
  recordedAt?: string; // ISO
  note?: string;
  settled?: ReconcileSettlement; // change returned / overspend reimbursed
}

function coerceDoc(v: unknown): SaleDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || typeof o.name !== "string") return null;
  return { path: o.path, name: o.name, uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "" };
}

export function coerceReconciliation(v: unknown): Reconciliation {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  const s = o.settled && typeof o.settled === "object" ? (o.settled as Record<string, unknown>) : null;
  return {
    voucherAmount: typeof o.voucherAmount === "number" ? o.voucherAmount : undefined,
    actualSpent: typeof o.actualSpent === "number" ? o.actualSpent : undefined,
    receipts: Array.isArray(o.receipts) ? o.receipts.map(coerceDoc).filter((d): d is SaleDoc => d !== null) : undefined,
    recordedByName: typeof o.recordedByName === "string" ? o.recordedByName : undefined,
    recordedRole: typeof o.recordedRole === "string" ? o.recordedRole : undefined,
    recordedAt: typeof o.recordedAt === "string" ? o.recordedAt : undefined,
    note: typeof o.note === "string" ? o.note : undefined,
    settled: s
      ? {
          byName: typeof s.byName === "string" ? s.byName : "",
          role: typeof s.role === "string" ? s.role : "",
          at: typeof s.at === "string" ? s.at : "",
          note: typeof s.note === "string" ? s.note : undefined,
        }
      : undefined,
  };
}

export type ReconcileStatus = "balanced" | "change" | "over";

/** Compare the issued voucher against the actual spend. variance = voucher − spent. */
export function computeVariance(voucherAmount: number, actualSpent: number): { variance: number; status: ReconcileStatus } {
  const variance = round2(voucherAmount - actualSpent);
  if (Math.abs(variance) < 0.005) return { variance: 0, status: "balanced" };
  return { variance, status: variance > 0 ? "change" : "over" };
}

/** Has the purchaser recorded the actual spend + receipts for this PO yet? */
export function isReconciled(r: Reconciliation): boolean {
  return typeof r.actualSpent === "number";
}
