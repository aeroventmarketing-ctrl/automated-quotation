import { prisma } from "./db";
import { config } from "./config";
import type { Prisma } from "@prisma/client";

/**
 * Generate the next per-year quote number (AQ-YYYY-NNNN) atomically.
 * Uses an upsert + increment inside the caller's transaction when provided.
 */
export async function nextQuoteNumber(
  tx: Prisma.TransactionClient = prisma,
  year = new Date().getFullYear(),
): Promise<string> {
  const counter = await tx.quoteCounter.upsert({
    where: { year },
    create: { year, lastValue: 1 },
    update: { lastValue: { increment: 1 } },
  });
  const seq = String(counter.lastValue).padStart(4, "0");
  return `AQ-${year}-${seq}`;
}

export interface LineInput {
  qty: number;
  unitPrice: number;
}

export interface Totals {
  subtotal: number;
  vat: number;
  total: number;
}

/** Deterministic totals: subtotal -> VAT (configurable rate) -> total. */
export function computeTotals(
  lines: LineInput[],
  vatRate = config.vatRate,
): Totals {
  const subtotal = lines.reduce(
    (acc, l) => acc + round2(l.qty * l.unitPrice),
    0,
  );
  const vat = round2(subtotal * vatRate);
  const total = round2(subtotal + vat);
  return { subtotal: round2(subtotal), vat, total };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
