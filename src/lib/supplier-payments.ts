/**
 * Payments made TO A SUPPLIER against a purchase order.
 *
 * The owner, on the Purchasing Budgeted tab: *"add an option to add lists of
 * payments and dates of payments made. Add a link to upload proof of payment and
 * eye view for easy viewing. Some PO requires DP to suppliers, we want to monitor
 * those payments made."*
 *
 * A record, not a step: it never moves a PO along the chain or gates anything.
 * Stored in `PurchaseRequest.supplierPayments` (migration 0061), on the anchor
 * request of a combined PO. Pure.
 */
export interface SupplierPaymentProof {
  path: string;
  name: string;
  uploadedAt: string;
}

export interface SupplierPayment {
  id: string;
  /** Pesos paid. */
  amount: number;
  /** The day it was paid, `YYYY-MM-DD`. */
  date: string;
  note?: string;
  proof?: SupplierPaymentProof | null;
  /** Who recorded it, and when (ISO) — not the same as when it was paid. */
  byName: string;
  at: string;
  /** Who last corrected it, and when (ISO). */
  editedByName?: string;
  editedAt?: string;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Read a stored list; malformed entries (no amount, no valid date) are dropped. Sorted by date. */
export function coerceSupplierPayments(value: unknown): SupplierPayment[] {
  if (!Array.isArray(value)) return [];
  const out: SupplierPayment[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const amount = Number(o.amount);
    const date = typeof o.date === "string" ? o.date.slice(0, 10) : "";
    if (!(amount > 0) || !YMD.test(date) || typeof o.id !== "string" || !o.id) continue;
    const p = o.proof as Record<string, unknown> | null | undefined;
    const proof = p && typeof p.path === "string" && p.path.startsWith("purchases/")
      ? { path: p.path, name: typeof p.name === "string" && p.name ? p.name : "proof", uploadedAt: typeof p.uploadedAt === "string" ? p.uploadedAt : "" }
      : null;
    const note = typeof o.note === "string" ? o.note.trim() : "";
    out.push({
      id: o.id,
      amount: Math.round(amount * 100) / 100,
      date,
      ...(note ? { note } : {}),
      proof,
      byName: typeof o.byName === "string" ? o.byName : "",
      at: typeof o.at === "string" ? o.at : "",
      ...(typeof o.editedByName === "string" && o.editedByName ? { editedByName: o.editedByName, editedAt: typeof o.editedAt === "string" ? o.editedAt : "" } : {}),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
}

export interface SupplierPaymentTotals {
  paid: number;
  /** What is still owed against `due` (never negative). */
  balance: number;
  /** Paid more than `due`. */
  over: number;
  /** Paid as a share of `due`, 0–100+ (null when there is no `due`). */
  pct: number | null;
}

/** Totals against what the supplier is owed (the PO's net — total less EWT). */
export function supplierPaymentTotals(payments: SupplierPayment[], due: number): SupplierPaymentTotals {
  const paid = Math.round(payments.reduce((a, p) => a + p.amount, 0) * 100) / 100;
  const diff = Math.round((due - paid) * 100) / 100;
  return {
    paid,
    balance: Math.max(0, diff),
    over: Math.max(0, -diff),
    pct: due > 0 ? Math.round((paid / due) * 1000) / 10 : null,
  };
}
