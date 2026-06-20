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
