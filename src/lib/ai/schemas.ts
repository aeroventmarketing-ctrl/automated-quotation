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
