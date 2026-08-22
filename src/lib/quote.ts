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
  /**
   * A flat, VAT-INCLUSIVE line (KDK, Aerovent Jet Fan / Inline Duct Fan): its
   * amount is charged as-is in every VAT mode — never ÷1.12 (exclusive) or with
   * VAT added on top. It carries no VAT of its own, so it sits at full value in
   * both the net and the gross total.
   */
  vatExempt?: boolean;
}

/**
 * Products whose catalogue price is a FLAT, VAT-inclusive selling price that must
 * never be scaled by the quote's VAT presentation (shown/charged as-is in every
 * mode): all KDK products, plus the Aerovent Jet Fan and Inline Duct Fan. Every
 * surface that adjusts prices by VAT mode uses this one rule.
 */
export function isFlatVatLine(specs: { brand?: unknown; type?: unknown } | null | undefined): boolean {
  const brand = String(specs?.brand ?? "").trim();
  const type = String(specs?.type ?? "").trim();
  if (brand === "KDK") return true;
  // Aerovent Jet Fan / Inline Duct Fan. Only AlphaAir also carries these types,
  // and its versions are NOT flat, so exclude AlphaAir and treat the rest as
  // Aerovent. ("Customized Jet Fan" is a different, fabricated type — not flat.)
  if ((type === "Jet Fan" || type === "Inline Duct Fan") && brand !== "AlphaAir") return true;
  return false;
}

export interface Totals {
  /** Net of VAT (VAT-exclusive base) — VATable net + the full flat-line amount. */
  subtotal: number;
  /** VAT amount (12%) — only on the VATable lines. */
  vat: number;
  /** Gross, VAT-inclusive total (= sum of line totals, since prices include VAT). */
  total: number;
  /** The flat, VAT-inclusive portion (KDK etc.) — same in the net and the gross. */
  vatExemptTotal: number;
}

/**
 * Deterministic totals. Catalogue/quote prices are entered VAT-INCLUSIVE, so the
 * gross total is the sum of line totals; the net and VAT are derived by dividing
 * the rate out of the VATABLE lines only. FLAT lines (`vatExempt`) carry no VAT,
 * so they sit at full value in both the net (subtotal) and the gross (total).
 * Presentation (inclusive vs exclusive) is decided per-quote at render time.
 */
export function computeTotals(
  lines: LineInput[],
  vatRate = config.vatRate,
): Totals {
  let vatableGross = 0;
  let vatExemptTotal = 0;
  for (const l of lines) {
    const lt = l.lineTotal ?? round2(l.qty * l.unitPrice);
    if (l.vatExempt) vatExemptTotal += lt;
    else vatableGross += lt;
  }
  vatableGross = round2(vatableGross);
  vatExemptTotal = round2(vatExemptTotal);
  const total = round2(vatableGross + vatExemptTotal);
  const vatableNet = round2(vatableGross / (1 + vatRate));
  const vat = round2(vatableGross - vatableNet);
  const subtotal = round2(vatableNet + vatExemptTotal);
  return { subtotal, vat, total, vatExemptTotal };
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
/**
 * The four VAT presentations a quotation can use:
 *  - INCLUSIVE      → the entered price already includes 12% VAT.
 *  - EXCLUSIVE      → the entered price is stripped of VAT (shown ÷1.12), no VAT charged.
 *  - EXCLUSIVE_PLUS → net price with 12% VAT added on top.
 *  - ZERO_RATED     → like INCLUSIVE in figure (the entered price IS the total) but the
 *                     sale is VAT zero-rated (0% output VAT; usually 1% EWT withheld).
 */
export type VatMode = "INCLUSIVE" | "EXCLUSIVE" | "EXCLUSIVE_PLUS" | "ZERO_RATED";

/**
 * Whether the displayed base is the entered (gross) price — true for INCLUSIVE and
 * ZERO_RATED (the entered figure is already the final amount); the exclusive modes
 * strip VAT to show the net.
 */
export function vatDisplayBasisIsGross(vatMode: string): boolean {
  return vatMode === "INCLUSIVE" || vatMode === "ZERO_RATED";
}
/** Whether 12% VAT is added on top of the net (only EXCLUSIVE_PLUS). */
export function vatModeAddsVat(vatMode: string): boolean {
  return vatMode === "EXCLUSIVE_PLUS";
}
/**
 * Whether the sale charges the client output VAT — INCLUSIVE (baked in) and
 * EXCLUSIVE_PLUS (added on top) do; EXCLUSIVE and ZERO_RATED do not.
 */
export function vatModeChargesOutputVat(vatMode: string): boolean {
  return vatMode === "INCLUSIVE" || vatMode === "EXCLUSIVE_PLUS";
}

/**
 * The pricing to apply for a given VAT mode. For EXCLUSIVE_PLUS the client price
 * is presented as net + 12% VAT, so a FLAT (amount) mark-up / discount — a
 * VAT-INCLUSIVE peso figure the user typed — is scaled DOWN by 1.12 before it's
 * applied to the net base and grossed back up. That makes a flat ₱X mark-up /
 * discount move the client total by exactly ₱X, identical to VAT inclusive.
 * Percentages need no scaling (they track the base); INCLUSIVE, EXCLUSIVE
 * (÷1.12) and ZERO_RATED are returned unchanged.
 */
export function pricingForVatMode(p: PricingAdjust, vatMode: string, vatRate = config.vatRate): PricingAdjust {
  if (vatMode !== "EXCLUSIVE_PLUS") return p;
  const f = 1 + vatRate;
  return {
    ...p,
    markupValue: p.markupMode === "amount" ? p.markupValue / f : p.markupValue,
    discountValue: p.discountMode === "amount" ? p.discountValue / f : p.discountValue,
  };
}

/**
 * The flat, VAT-inclusive portion of a quote (KDK etc.), stored on the quote's
 * `classification.vatExemptTotal` at save time so downstream figures (payable
 * total, reports) can strip VAT from the VATABLE lines only. 0 when absent.
 */
export function readVatExemptTotal(classification: unknown): number {
  const v = (classification as Record<string, unknown> | null)?.vatExemptTotal;
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

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
  // Flat (VAT-inclusive) lines carry no VAT: keep them at full value in the net.
  const flat = Math.min(readVatExemptTotal(q.classification), gross);
  const net = round2((gross - flat) / (1 + vatRate) + flat);
  const displayedNet = vatDisplayBasisIsGross(q.vatMode) ? gross : net;
  const pricing = pricingForVatMode(readPricing(q.classification, Number(q.discountPct)), q.vatMode, vatRate);
  const { finalNet } = applyPricing(displayedNet, pricing);
  // EXCLUSIVE_PLUS adds VAT on top — but only on the VATable share (flat lines
  // never get VAT added), pro-rated through any mark-up / discount.
  const vatableShare = displayedNet > 0 ? Math.max(0, (displayedNet - flat) / displayedNet) : 0;
  const vatAmt = vatModeAddsVat(q.vatMode) ? finalNet * vatableShare * vatRate : 0;
  return round2(finalNet + vatAmt);
}
