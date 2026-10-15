/**
 * Has an order had its Acknowledgement Form uploaded?
 *
 * The owner, on the Orders list: *"list all order number that have been
 * uploaded with acknowledgement form"*.
 *
 * The Acknowledgement Form is the `or_cr_af` closing-document slot on a
 * VAT-exclusive order (`collectionReceiptLabel(false)`); on a VAT-inclusive
 * order the same slot is the Collection Receipt. It is uploaded on the order,
 * or — for a multiple-batch delivery — on each batch. The unsigned copy made
 * when the delivery documents are prepared rides in `unsigned_or_cr_af`.
 */
import type { SaleDoc } from "@/lib/sale";

export type AckFormState = "signed" | "unsigned" | null;

type Docs = Record<string, SaleDoc[] | undefined> | undefined;

const has = (docs: Docs, key: string) => (docs?.[key]?.length ?? 0) > 0;

/**
 * "signed" — the signed Acknowledgement Form is on the order or on any batch;
 * "unsigned" — only the unsigned copy is; null — none, or not a VAT-exclusive
 * order (its slot is the Collection Receipt, not an Acknowledgement Form).
 */
export function ackFormState(vatMode: string | null | undefined, orderDocs: Docs, batches: { docs?: Docs; cancelled?: boolean }[] = []): AckFormState {
  if (vatMode !== "EXCLUSIVE") return null;
  const all = [orderDocs, ...batches.filter((b) => !b.cancelled).map((b) => b.docs)];
  if (all.some((d) => has(d, "or_cr_af"))) return "signed";
  if (all.some((d) => has(d, "unsigned_or_cr_af"))) return "unsigned";
  return null;
}

// --- AI check: is the uploaded file really an Acknowledgement Form? ---------
//
// The owner: *"use the AI reading capacity to verify if the uploaded image is an
// acknowledgement form or acknowledgement receipt"*. The slot accepts any file,
// so a Sales Invoice, a Delivery Form or a photo of something else can sit where
// the Acknowledgement Form should be. The AI names what the document actually
// is; the verdict is stored per file on the order (`classification.ackFormChecks`,
// keyed by storage path) and shown on the Orders list.

export const ACK_DOC_KINDS = [
  "acknowledgement_form",
  "acknowledgement_receipt",
  "collection_receipt",
  "official_receipt",
  "sales_invoice",
  "delivery_receipt",
  "delivery_form",
  "other",
] as const;
export type AckDocKind = (typeof ACK_DOC_KINDS)[number];

export const ACK_DOC_KIND_LABEL: Record<AckDocKind, string> = {
  acknowledgement_form: "Acknowledgement Form",
  acknowledgement_receipt: "Acknowledgement Receipt",
  collection_receipt: "Collection Receipt",
  official_receipt: "Official Receipt",
  sales_invoice: "Sales Invoice",
  delivery_receipt: "Delivery Receipt",
  delivery_form: "Delivery Form",
  other: "Something else",
};

/** Below this the AI isn't sure enough to call it either way. */
export const ACK_CHECK_CONFIDENCE_MIN = 0.7;

export type AckVerdict = "ack" | "not_ack" | "unclear";

export function ackVerdict(kind: AckDocKind | null, confidence: number): AckVerdict {
  if (!kind || confidence < ACK_CHECK_CONFIDENCE_MIN) return "unclear";
  return kind === "acknowledgement_form" || kind === "acknowledgement_receipt" ? "ack" : "not_ack";
}

export interface AckCheck {
  verdict: AckVerdict;
  kind: AckDocKind | null;
  /** The document's title as printed, e.g. "ACKNOWLEDGEMENT RECEIPT". */
  titleSeen: string | null;
  confidence: number;
  reason: string | null;
  checkedAt: string;
  checkedByName: string;
}

export function coerceAckChecks(v: unknown): Record<string, AckCheck> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, AckCheck> = {};
  for (const [path, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const verdict = o.verdict === "ack" || o.verdict === "not_ack" || o.verdict === "unclear" ? o.verdict : null;
    if (!verdict) continue;
    const kind = (ACK_DOC_KINDS as readonly string[]).includes(o.kind as string) ? (o.kind as AckDocKind) : null;
    out[path] = {
      verdict,
      kind,
      titleSeen: typeof o.titleSeen === "string" ? o.titleSeen : null,
      confidence: typeof o.confidence === "number" ? o.confidence : 0,
      reason: typeof o.reason === "string" ? o.reason : null,
      checkedAt: typeof o.checkedAt === "string" ? o.checkedAt : "",
      checkedByName: typeof o.checkedByName === "string" ? o.checkedByName : "",
    };
  }
  return out;
}

export interface AckFile {
  path: string;
  name: string;
  signed: boolean;
  /** The delivery batch's DR number, when uploaded on a batch. */
  batch?: string;
}

/** Every file uploaded in an Acknowledgement Form slot of a VAT-exclusive order. */
export function ackFormFiles(
  vatMode: string | null | undefined,
  orderDocs: Docs,
  batches: { docs?: Docs; cancelled?: boolean; drNumber?: string }[] = [],
): AckFile[] {
  if (vatMode !== "EXCLUSIVE") return [];
  const out: AckFile[] = [];
  const take = (docs: Docs, batch?: string) => {
    for (const [key, signed] of [["or_cr_af", true], ["unsigned_or_cr_af", false]] as const) {
      for (const d of docs?.[key] ?? []) out.push({ path: d.path, name: d.name, signed, ...(batch ? { batch } : {}) });
    }
  };
  take(orderDocs);
  for (const b of batches) if (!b.cancelled) take(b.docs, b.drNumber || "batch");
  // The same file can't be two uploads.
  return out.filter((f, i) => out.findIndex((g) => g.path === f.path) === i);
}

export type AckAiState = "verified" | "flagged" | "unclear" | "unchecked" | null;

/**
 * The order's AI state over all its Acknowledgement Form files: "flagged" if any
 * file is NOT one, "unclear" if any read wasn't sure, "unchecked" if any file
 * hasn't been checked, "verified" when every file was confirmed. Null: no files.
 */
export function ackAiState(files: AckFile[], checks: Record<string, AckCheck>): AckAiState {
  if (files.length === 0) return null;
  const v: (AckVerdict | null)[] = files.map((f) => checks[f.path]?.verdict ?? null);
  if (v.includes("not_ack")) return "flagged";
  if (v.includes("unclear")) return "unclear";
  if (v.includes(null)) return "unchecked";
  return "verified";
}
