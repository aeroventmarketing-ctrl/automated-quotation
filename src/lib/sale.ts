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
  docs?: Record<string, SaleDoc[]>; // additional order documents, by type key
  note?: string; // additional information given by the client
}

export interface SaleDocType {
  key: string;
  label: string;
  required: boolean;
  /** Other doc keys whose files also show (and can be removed) in this slot. */
  mergeKeys?: string[];
  /** Part of the documents-checked gate — highlighted until a file is attached. */
  important?: boolean;
}

/** Document slots shown before the "Payments collected" section, in order. */
export const SALE_DOCS_BEFORE_PAYMENTS: SaleDocType[] = [
  // The Inquiry Form (seeded from the inquiry) folds into this slot.
  { key: "computation", label: "Computation / Inquiry Form", required: true, mergeKeys: ["inquiry_form"], important: true },
  { key: "quotation", label: "Quotation", required: true, important: true },
  { key: "rfq_boq", label: "RFQ / BOQ", required: true, important: true },
  { key: "drawing", label: "Drawing / Pictures", required: false },
  { key: "billing_dp", label: "Billing Statement DP", required: false },
  { key: "billing_fp", label: "Billing Statement FP", required: false },
];
/** Document slots shown after the "Payments collected" section, in order. */
export const SALE_DOCS_AFTER_PAYMENTS: SaleDocType[] = [
  { key: "sales_invoice", label: "Sales Invoice", required: true },
  { key: "or_cr_af", label: "OR / CR / AF", required: true },
  { key: "delivery_receipt", label: "Delivery Receipt / Delivery Form", required: true },
  { key: "bir_2307", label: "BIR 2307", required: true },
];
export const SALE_DOC_TYPES: SaleDocType[] = [...SALE_DOCS_BEFORE_PAYMENTS, ...SALE_DOCS_AFTER_PAYMENTS];

/**
 * The after-payment (closing) document slots that apply to a transaction. For
 * VAT-exclusive deals the Sales Invoice and BIR 2307 aren't required, so those
 * slots are hidden. VAT-inclusive shows all four.
 */
export function afterPaymentDocTypes(vatInclusive: boolean): SaleDocType[] {
  return SALE_DOCS_AFTER_PAYMENTS.filter(
    (t) => vatInclusive || (t.key !== "sales_invoice" && t.key !== "bir_2307"),
  );
}

/**
 * Whether an order's closing documents are in place. `appear` gates the
 * "File documents — close order" button (all required except BIR 2307);
 * `complete` means everything incl. BIR 2307 is attached; `bir2307Missing`
 * flags the incomplete case (VAT-inclusive with no 2307 yet).
 */
export function closeDocsState(docs: Record<string, SaleDoc[]> | undefined, vatInclusive: boolean) {
  const has = (k: string) => (docs?.[k]?.length ?? 0) > 0;
  const appearKeys = ["or_cr_af", "delivery_receipt", ...(vatInclusive ? ["sales_invoice"] : [])];
  const appear = appearKeys.every(has);
  const bir2307Missing = vatInclusive && !has("bir_2307");
  return { appear, complete: appear && !bir2307Missing, bir2307Missing, missing: appearKeys.filter((k) => !has(k)) };
}

/** Coerce one raw doc record into a SaleDoc, or null. */
function coerceDoc(v: unknown): SaleDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path) return null;
  return { path: o.path, name: typeof o.name === "string" ? o.name : o.path.split("/").pop() ?? "file", uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "" };
}

/** Coerce the docs map (each type → array of SaleDoc). */
export function coerceSaleDocs(value: unknown): Record<string, SaleDoc[]> {
  const out: Record<string, SaleDoc[]> = {};
  if (!value || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const arr = (Array.isArray(v) ? v : [v]).map(coerceDoc).filter((d): d is SaleDoc => d !== null);
    if (arr.length) out[k] = arr;
  }
  return out;
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

/**
 * Documents that must be attached before an order's documents can be marked
 * "checked" (the doc_check step). Returns the labels still missing.
 */
export function docCheckMissing(sale: SaleRecord | null | undefined): string[] {
  const missing: string[] = [];
  if (!sale?.po) missing.push("Purchase Order");
  const docs = sale?.docs ?? {};
  // Computation / Inquiry Form is satisfied by either a computation or an
  // inquiry-form file (they share one slot).
  if (!(docs["computation"]?.length || docs["inquiry_form"]?.length)) missing.push("Computation / Inquiry Form");
  const need: [string, string][] = [
    ["quotation", "Quotation"],
    ["rfq_boq", "RFQ / BOQ"],
  ];
  for (const [key, label] of need) if (!(docs[key]?.length)) missing.push(label);
  return missing;
}

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
    docs: coerceSaleDocs(s.docs),
    note: typeof s.note === "string" ? s.note : undefined,
  };
}
