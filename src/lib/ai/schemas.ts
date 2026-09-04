import { z } from "zod";

// Validated shape of an AI-extracted inquiry line item.
export const extractedItemSchema = z.object({
  description: z.string().default(""),
  airflow: z.number().nullable().default(null),
  airflowUnit: z
    .enum(["CFM", "m3/hr", "m3/s", "L/s"])
    .nullable()
    .default(null),
  staticPressure: z.number().nullable().default(null),
  pressureUnit: z.enum(["Pa", "mmAq", "inWG", "kPa"]).nullable().default(null),
  qty: z.number().int().positive().nullable().default(null),
  application: z.string().nullable().default(null),
  modelText: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

export const extractionResultSchema = z.object({
  items: z.array(extractedItemSchema).default([]),
});

export type ExtractedItem = z.infer<typeof extractedItemSchema>;
export type ExtractionResult = z.infer<typeof extractionResultSchema>;

// Validated shape of a catalogue-match candidate.
export const matchCandidateSchema = z.object({
  catalogueItemId: z.string(),
  modelCode: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string().default(""),
});

export const matchResultSchema = z.object({
  candidates: z.array(matchCandidateSchema).default([]),
});

export type MatchCandidate = z.infer<typeof matchCandidateSchema>;
export type MatchResult = z.infer<typeof matchResultSchema>;

// --- Receipt reading (voucher reconciliation) -------------------------------
// One entry per PO line, in the same order, carrying the actual amount the AI
// found for it on the receipt(s).
export const receiptLineSchema = z.object({
  actualAmount: z.number().nullable().default(null),
  matched: z.boolean().default(false),
  note: z.string().default(""),
});

export const receiptReadSchema = z.object({
  supplier: z.string().nullable().default(null),
  // The receipt / sales-invoice serial number (e.g. the red pre-printed "No." on a
  // supplier sales-invoice booklet). Used to flag a re-used invoice number.
  invoiceNumber: z.string().nullable().default(null),
  date: z.string().nullable().default(null),
  vatMode: z.enum(["inclusive", "exclusive"]).nullable().default(null),
  receiptTotal: z.number().nullable().default(null),
  lines: z.array(receiptLineSchema).default([]),
  extraItems: z
    .array(z.object({ description: z.string().default(""), amount: z.number().nullable().default(null) }))
    .default([]),
  warnings: z.array(z.string()).default([]),
});

export type ReceiptRead = z.infer<typeof receiptReadSchema>;

// --- Deposit-slip / proof-of-payment reading --------------------------------
// Reads a bank deposit slip / online-transfer proof to auto-fill a payment's
// date + amount. ONLY the machine-validation imprint or computer-generated text
// counts — handwritten figures are ignored and must NOT be accepted.
export const depositSlipReadSchema = z.object({
  documentType: z.string().nullable().default(null), // e.g. "bank deposit slip", "online transfer"
  machineValidated: z.boolean().default(false), // bank teller machine validation imprint present
  computerGenerated: z.boolean().default(false), // fully computer-generated proof (app / e-transfer)
  handwrittenOnly: z.boolean().default(false), // the date/amount are only handwritten
  date: z.string().nullable().default(null), // YYYY-MM-DD read from the machine/computer text
  amount: z.number().nullable().default(null), // peso amount from the machine/computer text
  reference: z.string().nullable().default(null), // reference / transaction / OR number
  bank: z.string().nullable().default(null),
  confidence: z.number().nullable().default(null), // 0..1 — how sure the exact digits were read
  warnings: z.array(z.string()).default([]),
});

export type DepositSlipRead = z.infer<typeof depositSlipReadSchema>;

// --- Closing-document reading (Sales Invoice / Collection Receipt / Delivery
//     Receipt) -------------------------------------------------------------
// Reads a signed closing document to (a) capture its document number so the same
// number can't be reused on another order, and (b) verify its amount against the
// order total. Applies to VAT-inclusive / zero-rated deals (the only ones that
// carry a Sales Invoice + Collection Receipt).
export const saleDocReadSchema = z.object({
  documentKind: z.string().nullable().default(null), // e.g. "Sales Invoice", "Collection Receipt", "Delivery Receipt"
  // The pre-printed serial number of the document (SI No. / CR No. / DR No.).
  // This is the fingerprint used to block re-use across orders.
  documentNumber: z.string().nullable().default(null),
  date: z.string().nullable().default(null), // YYYY-MM-DD document date
  amount: z.number().nullable().default(null), // peso total shown on the document (null if none is printed)
  // EWT withheld (BIR 2307) shown on a Collection Receipt's settlement box —
  // the gross-minus-net difference. Autofills the Sales Summary's EWT FP column.
  ewtAmount: z.number().nullable().default(null),
  customer: z.string().nullable().default(null), // sold-to / customer name if shown
  customerTin: z.string().nullable().default(null), // sold-to / customer TIN if shown
  confidence: z.number().nullable().default(null), // 0..1 — how sure the exact number + amount were read
  warnings: z.array(z.string()).default([]),
});

export type SaleDocRead = z.infer<typeof saleDocReadSchema>;

// --- Check reading (the photo of the check issued for a PO's voucher) --------
// The owner's field map, taken off a practice check: (a) Account No., (b) Account
// name — always OURS, (c) Check No., (d) Pay to the order of — the supplier,
// (e) Date — the clearing date, (f) the peso box — the amount in figures,
// (g) the PESOS line — the amount in words.
//
// The amount is deliberately returned TWICE, in figures and in words, because a
// check carries its own cross-check on its face: if the two disagree, the read
// is wrong (or the check is), and the system can say so without a human noticing.
export const checkReadSchema = z.object({
  accountNo: z.string().nullable().default(null), // (a) the account the check is drawn on
  accountName: z.string().nullable().default(null), // (b) the account holder — should be us
  checkNo: z.string().nullable().default(null), // (c) pre-printed check number, leading zeros kept
  payee: z.string().nullable().default(null), // (d) "Pay to the order of"
  date: z.string().nullable().default(null), // (e) YYYY-MM-DD — the DATE box (the clearing date)
  /**
   * (e) the eight DATE-box digits as printed, left to right — "10042026". The
   * boxes are labelled M M D D Y Y Y Y on the check, and the clearing date is
   * assembled from these IN CODE: asking the model for a date instead let
   * 10-04-2026 come back as 10 April.
   */
  dateDigits: z.string().nullable().default(null),
  amount: z.number().nullable().default(null), // (f) the figure in the peso box
  amountWords: z.string().nullable().default(null), // (g) the PESOS line, verbatim
  bank: z.string().nullable().default(null),
  isCheck: z.boolean().default(false), // the image really is a check, not some other document
  confidence: z.number().nullable().default(null), // 0..1 — how sure the exact digits were read
  warnings: z.array(z.string()).default([]),
});

export type CheckReadResult = z.infer<typeof checkReadSchema>;
