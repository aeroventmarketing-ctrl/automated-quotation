/**
 * Sale + payment tracking for a quotation (stored in the quote's classification
 * JSON, files in Supabase Storage). A sale is "confirmed" only when a PO is
 * attached and — unless the client is on terms — at least one payment recorded.
 * The dashboard counts only the amount actually collected (sum of payments).
 */

export type SaleArrangement = "downpayment_full" | "downpayment_progress" | "terms";
export type PaymentKind = "down" | "full" | "progress";

export interface SaleDoc {
  path: string; // Supabase Storage path
  name: string; // original file name
  uploadedAt: string; // ISO
}

export interface SalePayment {
  id: string;
  kind: PaymentKind;
  amount: number;
  date: string; // ISO (collection date)
  proof?: SaleDoc | null; // proof of payment
  note?: string;
}

export interface SaleRecord {
  soldAt?: string; // ISO — when first confirmed
  recordedById?: string;
  arrangement: SaleArrangement;
  po?: SaleDoc | null; // purchase order document
  payments: SalePayment[];
}

export const ARRANGEMENT_LABEL: Record<SaleArrangement, string> = {
  downpayment_full: "Down payment → Full payment",
  downpayment_progress: "Down payment → Progress billing",
  terms: "Terms (PO)",
};

export const PAYMENT_KIND_LABEL: Record<PaymentKind, string> = {
  down: "Down payment",
  full: "Full payment",
  progress: "Progress billing",
};

/** Total amount actually collected so far. */
export function collectedTotal(sale: SaleRecord | null | undefined): number {
  return (sale?.payments ?? []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
}

/**
 * A real sale: a PO is always required; plus at least one payment unless the
 * client is on terms (PO alone confirms a terms sale).
 */
export function isSaleConfirmed(sale: SaleRecord | null | undefined): boolean {
  if (!sale || !sale.po) return false;
  return sale.arrangement === "terms" || (sale.payments?.length ?? 0) > 0;
}

/** Read a SaleRecord out of a quotation's classification JSON (or null). */
export function saleFromClassification(classification: unknown): SaleRecord | null {
  const sale = (classification as Record<string, unknown> | null)?.sale;
  if (!sale || typeof sale !== "object") return null;
  const s = sale as Record<string, unknown>;
  if (!s.arrangement) return null;
  return {
    soldAt: typeof s.soldAt === "string" ? s.soldAt : undefined,
    recordedById: typeof s.recordedById === "string" ? s.recordedById : undefined,
    arrangement: s.arrangement as SaleArrangement,
    po: (s.po as SaleDoc) ?? null,
    payments: Array.isArray(s.payments) ? (s.payments as SalePayment[]) : [],
  };
}
