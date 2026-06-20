import { prisma } from "./db";
import { config, COMPANY } from "./config";
import type { Prisma } from "@prisma/client";

// Single global counter row id (QuoteCounter.year repurposed as a fixed key).
const GLOBAL_COUNTER_KEY = 0;

/**
 * Generate the next AFBM quote number, e.g. "2026 - AFBM00000041J":
 *   {YEAR} - {PREFIX}{8-digit running number}{salesCode}
 * The running number counts upward across all quotations (never resets); the
 * year is the current year for display; the trailing letter is the sales
 * person's assigned code.
 */
export async function nextQuoteNumber(
  tx: Prisma.TransactionClient = prisma,
  salesCode = "",
  year = new Date().getFullYear(),
): Promise<string> {
  const counter = await tx.quoteCounter.upsert({
    where: { year: GLOBAL_COUNTER_KEY },
    create: { year: GLOBAL_COUNTER_KEY, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  const seq = String(counter.lastValue).padStart(8, "0");
  const letter = (salesCode || "").trim().toUpperCase().slice(0, 1);
  return `${year} - ${COMPANY.quotePrefix}${seq}${letter}`;
}

export interface LineInput {
  qty: number;
  unitPrice: number;
}

export interface Totals {
  /** Net of VAT (VAT-exclusive base). */
  subtotal: number;
  /** VAT amount (12%). */
  vat: number;
  /** Gross, VAT-inclusive total (= sum of line totals, since prices include VAT). */
  total: number;
}

/**
 * Deterministic totals. Catalogue/quote prices are entered VAT-INCLUSIVE, so the
 * gross total is simply the sum of line totals; the net and VAT are derived by
 * dividing out the rate (net = gross / (1 + rate)). Presentation (inclusive vs
 * exclusive) is decided per-quote at render time, not here.
 */
export function computeTotals(
  lines: LineInput[],
  vatRate = config.vatRate,
): Totals {
  const total = round2(
    lines.reduce((acc, l) => acc + round2(l.qty * l.unitPrice), 0),
  );
  const subtotal = round2(total / (1 + vatRate));
  const vat = round2(total - subtotal);
  return { subtotal, vat, total };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
