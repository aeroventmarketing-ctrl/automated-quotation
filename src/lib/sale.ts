/**
 * Sale + payment tracking for a quotation (stored in the quote's classification
 * JSON, files in Supabase Storage). A sale is "confirmed" only when a PO is
 * attached and — unless the client is on terms — at least one payment recorded.
 * The dashboard counts only the amount actually collected (sum of payments).
 */

export type SaleArrangement = "downpayment_full" | "downpayment_progress" | "terms";
// "ewt" is not cash — it's the Expanded Withholding Tax the client withheld and
// remits to BIR on the company's behalf (backed by a BIR 2307). Counting it
// settles the deal value: cash received + EWT withheld = deal value.
export type PaymentKind = "down" | "full" | "progress" | "ewt";

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

/**
 * The closing-document slots whose files can be AI-read: the Sales Invoice, the
 * Collection Receipt (or_cr_af) and the Delivery Receipt. These carry a serial
 * number worth capturing (to block re-use) and, for the first two, an amount to
 * verify against the order total.
 */
export const AI_READABLE_SALE_DOC_KEYS = ["sales_invoice", "or_cr_af", "delivery_receipt"] as const;
export type AiReadableSaleDocKey = (typeof AI_READABLE_SALE_DOC_KEYS)[number];
export const isAiReadableSaleDocKey = (key: string): key is AiReadableSaleDocKey =>
  (AI_READABLE_SALE_DOC_KEYS as readonly string[]).includes(key);

/**
 * Result of AI-reading one closing document, persisted on the quote's
 * classification (keyed by the file's storage path — a sibling of `sale`, so it
 * survives `recordSale`). Records the captured document number, the amount vs
 * the order total, whether it validated, and who read it when.
 */
export interface SaleDocReadStamp {
  path: string; // the file this read is for
  docKey: string; // sale doc slot key (sales_invoice / or_cr_af / delivery_receipt)
  documentNumber: string | null; // captured serial (SI / CR / DR No.)
  date: string | null; // YYYY-MM-DD document date
  customerTin: string | null; // sold-to / customer TIN read off the document (autofills the Sales Summary)
  amount: number | null; // peso total read off the document
  expected: number | null; // order figure it was checked against (null if not checked)
  amountMatches: boolean | null; // amount ≈ expected (null if no amount / not checked)
  duplicateOf: string | null; // quote number where this document number is already used
  validated: boolean; // number captured, amount tallies, no duplicate
  readByName: string;
  readAt: string; // ISO
  // Admin / Payment Approver override — the upload is accepted regardless of the
  // AI read result (e.g. after Accounting hit the read limit). Also set when they
  // upload it themselves.
  approved?: { byName: string; at: string } | null;
}

/** A closing document is "cleared" when the AI validated it OR an approver accepted it. */
export const isSaleDocCleared = (s: SaleDocReadStamp | undefined | null): boolean =>
  !!s && (s.validated || !!s.approved);

/** Normalise a document number for comparison (case/spacing/punctuation-insensitive). */
export const normalizeDocNumber = (n: string | null | undefined): string =>
  (n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function coerceDocReadStamp(v: unknown): SaleDocReadStamp | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path) return null;
  return {
    path: o.path,
    docKey: typeof o.docKey === "string" ? o.docKey : "",
    documentNumber: typeof o.documentNumber === "string" ? o.documentNumber : null,
    date: typeof o.date === "string" ? o.date : null,
    customerTin: typeof o.customerTin === "string" ? o.customerTin : null,
    amount: typeof o.amount === "number" ? o.amount : null,
    expected: typeof o.expected === "number" ? o.expected : null,
    amountMatches: typeof o.amountMatches === "boolean" ? o.amountMatches : null,
    duplicateOf: typeof o.duplicateOf === "string" ? o.duplicateOf : null,
    validated: o.validated === true,
    readByName: typeof o.readByName === "string" ? o.readByName : "",
    readAt: typeof o.readAt === "string" ? o.readAt : "",
    approved:
      o.approved && typeof o.approved === "object"
        ? {
            byName: typeof (o.approved as Record<string, unknown>).byName === "string" ? (o.approved as Record<string, unknown>).byName as string : "",
            at: typeof (o.approved as Record<string, unknown>).at === "string" ? (o.approved as Record<string, unknown>).at as string : "",
          }
        : null,
  };
}

/** Read the persisted sale-doc AI reads off a quote classification (by file path). */
export function saleDocReadsFromClassification(classification: unknown): Record<string, SaleDocReadStamp> {
  const out: Record<string, SaleDocReadStamp> = {};
  if (!classification || typeof classification !== "object") return out;
  const raw = (classification as Record<string, unknown>).saleDocReads;
  if (!raw || typeof raw !== "object") return out;
  for (const [path, v] of Object.entries(raw as Record<string, unknown>)) {
    const stamp = coerceDocReadStamp(v);
    if (stamp) out[path] = stamp;
  }
  return out;
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
 * Certificate of VAT Exempt / Zero Rated — a required supporting document that
 * accompanies the closing documents of a **zero-rated** sale only.
 */
export const VAT_ZERO_CERT_DOC: SaleDocType = {
  key: "vat_zero_cert",
  label: "Certificate of VAT Exempt/Zero Rated",
  required: true,
};

/**
 * VAT-appropriate labels for the two slots whose name depends on the tax
 * treatment (mirrors the counter-sales taxonomy):
 * - `or_cr_af` → **Collection Receipt** (VAT-inclusive) / **Acknowledgement Form**
 *   (VAT-exclusive).
 * - the delivery document → **Delivery Receipt** (VAT-inclusive) / **Delivery Form**
 *   (VAT-exclusive).
 * The underlying doc keys never change, so existing uploads stay valid.
 */
export const collectionReceiptLabel = (vatInclusive: boolean) =>
  vatInclusive ? "Collection Receipt" : "Acknowledgement Form";
export const deliveryDocLabel = (vatInclusive: boolean) =>
  vatInclusive ? "Delivery Receipt" : "Delivery Form";

/** Apply the VAT-appropriate label to a slot (leaves other slots untouched). */
function vatLabel(t: SaleDocType, vatInclusive: boolean): SaleDocType {
  if (t.key === "or_cr_af" || t.key === "unsigned_or_cr_af")
    return { ...t, label: collectionReceiptLabel(vatInclusive) };
  if (t.key === "delivery_receipt" || t.key === "unsigned_dr")
    return { ...t, label: deliveryDocLabel(vatInclusive) };
  return t;
}

/**
 * Unsigned client documents attached when preparing the delivery documents
 * (before the client signs). Stored under their own keys, separate from the
 * signed closing documents. Sales Invoice only applies to VAT-inclusive deals.
 */
export const DELIVERY_UNSIGNED_DOCS: SaleDocType[] = [
  { key: "unsigned_si", label: "Sales Invoice", required: false },
  { key: "unsigned_or_cr_af", label: "OR / CR / AF", required: false },
  { key: "unsigned_dr", label: "Delivery Receipt / Delivery Form", required: false },
];
export function deliveryUnsignedDocTypes(vatInclusive: boolean): SaleDocType[] {
  return DELIVERY_UNSIGNED_DOCS.filter((t) => vatInclusive || t.key !== "unsigned_si").map((t) =>
    vatLabel(t, vatInclusive),
  );
}

/**
 * The after-payment (closing) document slots that apply to a transaction. For
 * VAT-exclusive deals the Sales Invoice and BIR 2307 aren't required, so those
 * slots are hidden — leaving the **Delivery Form** and **Acknowledgement Form**.
 * VAT-inclusive shows all four (Sales Invoice, **Collection Receipt**, **Delivery
 * Receipt**, BIR 2307).
 */
export function afterPaymentDocTypes(vatInclusive: boolean, zeroRated = false): SaleDocType[] {
  const base = SALE_DOCS_AFTER_PAYMENTS.filter(
    (t) => vatInclusive || (t.key !== "sales_invoice" && t.key !== "bir_2307"),
  ).map((t) => vatLabel(t, vatInclusive));
  // A zero-rated sale also requires the Certificate of VAT Exempt/Zero Rated.
  return zeroRated ? [...base, { ...VAT_ZERO_CERT_DOC }] : base;
}

/**
 * Whether an order's closing documents are in place. `appear` gates the
 * "File documents — close order" button (all required except BIR 2307);
 * `complete` means everything incl. BIR 2307 is attached; `bir2307Missing`
 * flags the incomplete case (VAT-inclusive with no 2307 yet).
 */
export function closeDocsState(docs: Record<string, SaleDoc[]> | undefined, vatInclusive: boolean, zeroRated = false) {
  const has = (k: string) => (docs?.[k]?.length ?? 0) > 0;
  const appearKeys = [
    "or_cr_af",
    "delivery_receipt",
    ...(vatInclusive ? ["sales_invoice"] : []),
    ...(zeroRated ? ["vat_zero_cert"] : []),
  ];
  const appear = appearKeys.every(has);
  const bir2307Missing = vatInclusive && !has("bir_2307");
  return { appear, complete: appear && !bir2307Missing, bir2307Missing, missing: appearKeys.filter((k) => !has(k)) };
}

/**
 * Plant pick up closing documents. The **delivery form** (made by the Warehouseman)
 * is always required. For a **VAT-exclusive** order it is paired with the
 * **Acknowledgement Form**. For a **VAT-inclusive** order Accounting also makes the
 * Sales Invoice, **Collection Receipt** and **Delivery Receipt**.
 */
export function plantDocTypes(vatInclusive: boolean, zeroRated = false): SaleDocType[] {
  const form: SaleDocType = { key: "delivery_form", label: "Delivery form (Warehouseman)", required: true };
  const cert = zeroRated ? [{ ...VAT_ZERO_CERT_DOC }] : [];
  if (!vatInclusive) return [form, { key: "or_cr_af", label: collectionReceiptLabel(false), required: true }, ...cert];
  return [
    form,
    { key: "sales_invoice", label: "Sales Invoice", required: true },
    { key: "or_cr_af", label: collectionReceiptLabel(true), required: true },
    { key: "delivery_receipt", label: deliveryDocLabel(true), required: true },
    ...cert,
  ];
}
export function plantCloseState(docs: Record<string, SaleDoc[]> | undefined, vatInclusive: boolean, zeroRated = false) {
  const has = (k: string) => (docs?.[k]?.length ?? 0) > 0;
  const missing = plantDocTypes(vatInclusive, zeroRated).map((t) => t.key).filter((k) => !has(k));
  const appear = missing.length === 0;
  return { appear, complete: appear, bir2307Missing: false, missing };
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
  ewt: "EWT withheld (BIR 2307)",
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

/** Total settling the deal value so far — cash payments plus any EWT withheld. */
export function collectedTotal(sale: SaleRecord | null | undefined): number {
  return (sale?.payments ?? []).reduce((a, p) => a + (Number(p.amount) || 0), 0);
}

/** The portion of the collected total that is EWT withheld (not cash). */
export function ewtWithheld(sale: SaleRecord | null | undefined): number {
  return (sale?.payments ?? []).filter((p) => p.kind === "ewt").reduce((a, p) => a + (Number(p.amount) || 0), 0);
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
