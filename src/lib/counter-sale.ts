/**
 * Counter Sales (walk-in / over-the-counter) domain helpers: totals, payment
 * methods, document slots and status labels. Kept separate from the manufactured
 * order workflow — a counter sale is a cash sale of finished goods off the shelf.
 */
import { config } from "@/lib/config";
import type { SaleDoc, SalePayment, PaymentKind } from "@/lib/sale";

/** Round to 2 decimals (kept local so this module stays client-bundle-safe). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type CounterSaleVatMode = "INCLUSIVE" | "EXCLUSIVE" | "ZERO_RATED";
export type CounterSaleStatusKey = "DRAFT" | "COMPLETED" | "VOID";

/** Coerce any stored/incoming value to a known VAT mode (defaults to INCLUSIVE). */
export function coerceCounterVatMode(v: unknown): CounterSaleVatMode {
  return v === "EXCLUSIVE" || v === "ZERO_RATED" ? v : "INCLUSIVE";
}

/** Short + long badge labels per VAT mode. */
export const COUNTER_VAT_LABEL: Record<CounterSaleVatMode, { short: string; long: string }> = {
  INCLUSIVE: { short: "VAT incl.", long: "VAT Inclusive" },
  EXCLUSIVE: { short: "VAT excl.", long: "VAT Exclusive" },
  ZERO_RATED: { short: "Zero-rated", long: "VAT Zero-Rated" },
};

export const COUNTER_STATUS_LABEL: Record<CounterSaleStatusKey, string> = {
  DRAFT: "Draft",
  COMPLETED: "Completed",
  VOID: "Void",
};

export interface CounterLineInput {
  qty: number;
  unitPrice: number;
  lineTotal?: number;
}

export interface CounterTotals {
  subtotal: number; // net of VAT (= total for a non-VAT / exclusive sale)
  vat: number; // 12% VAT (0 for an exclusive / non-VAT sale)
  total: number; // amount the client pays
}

/**
 * Totals for a counter sale. Entered unit prices are what the client pays.
 * INCLUSIVE: the price includes 12% VAT (VAT is backed out for the invoice).
 * EXCLUSIVE: a non-VAT sale (Delivery Form + Acknowledgement Form) — no VAT line.
 * ZERO_RATED: a zero-rated sale — the price IS the total, 0% output VAT (usually
 * 1% EWT withheld); like EXCLUSIVE there's no VAT line, so subtotal = total.
 */
export function counterTotals(
  lines: CounterLineInput[],
  vatMode: CounterSaleVatMode,
  vatRate = config.vatRate,
): CounterTotals {
  const total = round2(lines.reduce((a, l) => a + (l.lineTotal ?? round2(l.qty * l.unitPrice)), 0));
  if (vatMode === "INCLUSIVE") {
    const subtotal = round2(total / (1 + vatRate));
    return { subtotal, vat: round2(total - subtotal), total };
  }
  return { subtotal: total, vat: 0, total };
}

/** Payment methods offered at the counter. `nonCash` payments need clearing. */
export interface PaymentMethodDef {
  key: string;
  label: string;
  nonCash: boolean; // money isn't in-hand at pickup — track a "cleared" status
}
export const PAYMENT_METHODS: PaymentMethodDef[] = [
  { key: "cash", label: "Cash", nonCash: false },
  { key: "gcash", label: "GCash", nonCash: true },
  { key: "dated_check", label: "Dated check", nonCash: true },
  { key: "post_dated_check", label: "Post-dated check", nonCash: true },
  { key: "credit_card", label: "Credit card", nonCash: true },
  { key: "online", label: "Other online payment", nonCash: true },
];
export function paymentMethodDef(key: string): PaymentMethodDef {
  return PAYMENT_METHODS.find((m) => m.key === key) ?? PAYMENT_METHODS[0];
}
export function paymentMethodLabel(key: string): string {
  return paymentMethodDef(key).label;
}
/** Cash is cleared on completion; every other method starts uncleared. */
export function isCashMethod(key: string): boolean {
  return !paymentMethodDef(key).nonCash;
}

/** One document slot handed to the client. `optional` slots never block anything. */
export interface CounterDocSlot {
  key: string;
  label: string;
  optional?: boolean;
}

/**
 * Documents handed over, by VAT mode. Record-and-upload — the printed document
 * is attached (its number typed in the note), nothing is generated.
 *   INCLUSIVE  → Sales Invoice + Collection Receipt + Delivery Receipt (+ BIR 2307)
 *   ZERO_RATED → Sales Invoice + Collection Receipt + Delivery Receipt + EWT (BIR 2307)
 *   EXCLUSIVE  → Delivery Form + Acknowledgement Form (+ BIR 2307)
 * BIR 2307 is optional for INCLUSIVE / EXCLUSIVE (attached only when the client
 * carries one); for ZERO_RATED the EWT (BIR 2307) is expected, so it's not optional.
 */
export function counterDocSlots(vatMode: CounterSaleVatMode): CounterDocSlot[] {
  if (vatMode === "EXCLUSIVE") {
    return [
      { key: "delivery_form", label: "Delivery Form" },
      { key: "acknowledgement_form", label: "Acknowledgement Form" },
      { key: "bir_2307", label: "BIR 2307", optional: true },
    ];
  }
  const zeroRated = vatMode === "ZERO_RATED";
  return [
    { key: "sales_invoice", label: "Sales Invoice" },
    { key: "collection_receipt", label: "Collection Receipt" },
    { key: "delivery_receipt", label: "Delivery Receipt" },
    { key: "bir_2307", label: zeroRated ? "BIR 2307 (EWT)" : "BIR 2307", optional: !zeroRated },
    // A zero-rated sale also requires the Certificate of VAT Exempt/Zero Rated.
    ...(zeroRated ? [{ key: "vat_zero_cert", label: "Certificate of VAT Exempt/Zero Rated" }] : []),
  ];
}

/**
 * Proof of the final payment. Not one of the documents handed to the client, so
 * it isn't in `counterDocSlots()` — it sits under the Payments Collected list,
 * the same place it sits on an order. Kept in the same `docs` blob, which is why
 * the save actions accept it alongside the handover slots.
 */
export const COUNTER_FINAL_PAYMENT_SLOT: CounterDocSlot = { key: "final_payment", label: "Final payment proof", optional: true };

/** Every slot a file may be filed under: the handover documents + final payment proof. */
export function counterFileSlots(vatMode: CounterSaleVatMode): CounterDocSlot[] {
  return [...counterDocSlots(vatMode), COUNTER_FINAL_PAYMENT_SLOT];
}

/** Coerce a stored docs blob into a clean Record<slotKey, SaleDoc[]>. */
export function coerceCounterDocs(v: unknown): Record<string, SaleDoc[]> {
  const out: Record<string, SaleDoc[]> = {};
  if (!v || typeof v !== "object") return out;
  for (const [k, arr] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(arr)) continue;
    const docs = arr
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object" && typeof (d as SaleDoc).path === "string")
      .map((d) => ({ path: String(d.path), name: String(d.name ?? "file"), uploadedAt: String(d.uploadedAt ?? "") }));
    if (docs.length) out[k] = docs;
  }
  return out;
}

const PAYMENT_KINDS: PaymentKind[] = ["down", "full", "progress", "ewt"];

/**
 * Coerce a stored payments blob into a clean SalePayment[]. Same shape as an
 * order's payments (`SalePayment`) so the two lists read and behave alike —
 * including "ewt", the tax the client withheld rather than cash received.
 */
export function coerceCounterPayments(v: unknown): SalePayment[] {
  if (!Array.isArray(v)) return [];
  const out: SalePayment[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id) continue;
    const amount = Number(p.amount);
    const proof = p.proof && typeof p.proof === "object" && typeof (p.proof as SaleDoc).path === "string"
      ? { path: String((p.proof as SaleDoc).path), name: String((p.proof as SaleDoc).name ?? "file"), uploadedAt: String((p.proof as SaleDoc).uploadedAt ?? "") }
      : null;
    out.push({
      id: p.id,
      kind: PAYMENT_KINDS.includes(p.kind as PaymentKind) ? (p.kind as PaymentKind) : "down",
      amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
      date: typeof p.date === "string" ? p.date.slice(0, 10) : "",
      proof,
      ...(typeof p.note === "string" && p.note ? { note: p.note } : {}),
    });
  }
  return out;
}

/** Total collected across the recorded payments (EWT included — it settles the deal). */
export function counterCollected(payments: SalePayment[]): number {
  return round2(payments.reduce((a, p) => a + (Number(p.amount) || 0), 0));
}

/** Next counter-sale number, e.g. "CS-2026-00001". Claim inside a transaction. */
export function formatCounterSaleNumber(year: number, seq: number): string {
  return `CS-${year}-${String(seq).padStart(5, "0")}`;
}

/**
 * Who may record, view and complete counter sales: Sales (base role), Admin, and
 * the Accounting / Warehouse / Payment Approver workflow roles (cashier + the
 * people who hand over stock or clear payment).
 */
export const COUNTER_SALE_WORKFLOW_ROLES = ["accounting", "warehouse", "payment_approver"] as const;
export function counterSaleRoleAllowed(opts: { admin: boolean; baseRole: string; workflowRoles: string[]; salesPersonnel?: boolean }): boolean {
  if (opts.admin) return true;
  if (opts.baseRole === "SALES") return true;
  // An Engineer marked "Credit as salesperson" (sales personnel) also sells, so
  // they may record and view counter sales — only while that flag is ticked.
  if (opts.baseRole === "ENGINEER" && opts.salesPersonnel) return true;
  return COUNTER_SALE_WORKFLOW_ROLES.some((r) => opts.workflowRoles.includes(r));
}


/**
 * The lines on a counter sale that will NOT move inventory.
 *
 * A sale line is only deducted from stock when it carries a `stockItemId` —
 * i.e. when the item was chosen from the stock picker. The picker DEFAULTS to
 * *"Ad-hoc / Not In Inventory"*, so a line whose name was typed into the
 * description box beside it, rather than picked, sells the goods and leaves the
 * on-hand untouched.
 *
 * That is correct behaviour for a genuine ad-hoc item — something sold that the
 * warehouse does not carry — and it is silent, which is what made the owner
 * report *"Counter sales transaction — item doesn't deduct on inventory
 * record."* The sale is right; nothing said which half of it moved stock.
 *
 * So the screens ask this function, and say so plainly.
 */
export function adhocLines<T extends { stockItemId?: string | null; description: string; qty: number | { toString(): string } }>(
  items: T[],
): T[] {
  return items.filter((i) => !i.stockItemId);
}

/** Do any lines on this sale bypass inventory? */
export function hasAdhocLines(items: Array<{ stockItemId?: string | null }>): boolean {
  return items.some((i) => !i.stockItemId);
}
