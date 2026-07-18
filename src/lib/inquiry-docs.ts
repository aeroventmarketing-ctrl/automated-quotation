/**
 * Pre-quotation documents attached to an inquiry: the Inquiry Form and the
 * RFQ / BOQ. Sales must attach both before a quotation can be created; they are
 * then seeded into the quotation's Sale & payment documents. (Client-safe — no
 * Prisma here; the DB read/write helpers live in inquiry-docs-store.ts.)
 */
import { coerceSaleDocs, type SaleDoc } from "@/lib/sale";

export interface InquiryDocType { key: string; label: string }
/** The required pre-quotation document slots, in order. */
export const INQUIRY_DOC_TYPES: InquiryDocType[] = [
  { key: "inquiry_form", label: "Inquiry Form" },
  { key: "rfq_boq", label: "RFQ / BOQ" },
];

/** Coerce raw JSON (Inquiry.docs) into a clean docs map. */
export function coerceInquiryDocs(value: unknown): Record<string, SaleDoc[]> {
  return coerceSaleDocs(value);
}

/** Labels of the required inquiry documents still missing. */
export function inquiryDocsMissing(docs: Record<string, SaleDoc[]> | null | undefined): string[] {
  const d = docs ?? {};
  return INQUIRY_DOC_TYPES.filter((t) => !(d[t.key]?.length)).map((t) => t.label);
}
