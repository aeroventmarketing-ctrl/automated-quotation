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
  /** Explicit gross line total; when omitted it's round2(qty × unitPrice). */
  lineTotal?: number;
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
    lines.reduce((acc, l) => acc + (l.lineTotal ?? round2(l.qty * l.unitPrice)), 0),
  );
  const subtotal = round2(total / (1 + vatRate));
  const vat = round2(total - subtotal);
  return { subtotal, vat, total };
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type AdjustMode = "percent" | "amount";

/** Header price adjustments: an optional mark-up (adds) and discount (subtracts). */
export interface PricingAdjust {
  markupMode: AdjustMode;
  markupValue: number;
  discountMode: AdjustMode;
  discountValue: number;
}

export const DEFAULT_PRICING: PricingAdjust = {
  markupMode: "percent",
  markupValue: 0,
  discountMode: "percent",
  discountValue: 0,
};

const asMode = (v: unknown): AdjustMode => (v === "amount" ? "amount" : "percent");
const asNum = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Read the pricing adjustments from a quotation's `classification.pricing`.
 * Falls back to the legacy percent-discount column when no pricing block exists
 * so older quotations keep rendering their discount.
 */
export function readPricing(classification: unknown, legacyDiscountPct = 0): PricingAdjust {
  const p = (classification as Record<string, unknown> | null)?.pricing as Record<string, unknown> | undefined;
  if (!p) {
    return { ...DEFAULT_PRICING, discountMode: "percent", discountValue: asNum(legacyDiscountPct) };
  }
  return {
    markupMode: asMode(p.markupMode),
    markupValue: asNum(p.markupValue),
    discountMode: asMode(p.discountMode),
    discountValue: asNum(p.discountValue),
  };
}

/**
 * Apply mark-up then discount to a displayed net base:
 *   displayedNet → + mark-up → − discount → finalNet.
 *
 * Percent mark-up uses the MARGIN method — the mark-up is that percent of the
 * FINAL price, so afterMarkup = net / (1 − pct) (e.g. 5% ⇒ net ÷ 0.95), not a
 * simple net × (1 + pct). Percent discount is a straight cut off the marked-up
 * amount (e.g. 10% ⇒ marked-up × 0.10). Amount modes are flat currency figures.
 */
export function applyPricing(displayedNet: number, p: PricingAdjust) {
  let afterMarkup: number;
  if (p.markupMode === "percent") {
    const denom = 1 - p.markupValue / 100;
    afterMarkup = denom > 0 ? displayedNet / denom : displayedNet;
  } else {
    afterMarkup = displayedNet + p.markupValue;
  }
  const markupAmt = afterMarkup - displayedNet;
  const discountAmt = p.discountMode === "percent" ? afterMarkup * (p.discountValue / 100) : p.discountValue;
  const finalNet = afterMarkup - discountAmt;
  return { markupAmt, afterMarkup, discountAmt, finalNet };
}

/**
 * The amount the client actually pays for a quotation — the stored gross total
 * (VAT-inclusive sum of line totals) after applying the discount and the VAT
 * presentation. This is the true "deal value": it drops when a quote is revised
 * with a discount. Mirrors the quotation builder's on-screen grand total.
 *
 *  - INCLUSIVE       → gross − discount
 *  - EXCLUSIVE (÷)   → (gross/1.12) − discount
 *  - EXCLUSIVE_PLUS  → ((gross/1.12) − discount) + 12% VAT
 */
export function payableTotal(
  q: {
    total: number | Prisma.Decimal;
    discountPct: number | Prisma.Decimal;
    vatMode: string;
    classification?: unknown;
  },
  vatRate = config.vatRate,
): number {
  const gross = Number(q.total);
  const net = gross / (1 + vatRate);
  const exclusive = q.vatMode !== "INCLUSIVE";
  const displayedNet = exclusive ? net : gross;
  const pricing = readPricing(q.classification, Number(q.discountPct));
  const { finalNet } = applyPricing(displayedNet, pricing);
  const vatAmt = q.vatMode === "EXCLUSIVE_PLUS" ? finalNet * vatRate : 0;
  return round2(finalNet + vatAmt);
}
