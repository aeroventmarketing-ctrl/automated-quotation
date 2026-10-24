import { describe, it, expect } from "vitest";
import { computeTotals, payableTotal, isFlatVatLine, zeroRatedKeepsGross, vatDisplayBasisIsGross } from "@/lib/quote";

// Fixtures mirror the owner-confirmed worked example: a fabricated F&B line
// (net ₱10,000 → gross ₱11,200, VATable) + a flat KDK line (₱14,931 VAT-inclusive).
const FNB = { qty: 1, unitPrice: 11200, vatExempt: false };
const KDK = { qty: 1, unitPrice: 14931, vatExempt: true };

describe("isFlatVatLine", () => {
  it("flags KDK, Aerovent Jet Fan and Inline Duct Fan; not AlphaAir / fabricated", () => {
    expect(isFlatVatLine({ brand: "KDK", type: "Ceiling Cassette" })).toBe(true);
    expect(isFlatVatLine({ brand: "Aerovent", type: "Jet Fan" })).toBe(true);
    expect(isFlatVatLine({ brand: "Aerovent", type: "Inline Duct Fan" })).toBe(true);
    expect(isFlatVatLine({ brand: "AlphaAir", type: "Jet Fan" })).toBe(false);
    expect(isFlatVatLine({ brand: "Aerovent", type: "Customized Jet Fan" })).toBe(false);
    expect(isFlatVatLine({ brand: "Aerovent", type: "Centrifugal Blower (SISW)" })).toBe(false);
    expect(isFlatVatLine(null)).toBe(false);
  });
});

describe("computeTotals — flat VAT-inclusive lines", () => {
  it("keeps a flat line at full value in both net and gross", () => {
    const t = computeTotals([FNB, KDK]);
    // gross = 11,200 + 14,931 ; net = 10,000 (F&B) + 14,931 (KDK, no VAT stripped)
    expect(t.total).toBe(26131);
    expect(t.subtotal).toBe(24931);
    expect(t.vat).toBe(1200); // VAT on the F&B line only
    expect(t.vatExemptTotal).toBe(14931);
  });

  it("matches the legacy formula when no line is flat", () => {
    const t = computeTotals([FNB]);
    expect(t.total).toBe(11200);
    expect(t.subtotal).toBe(10000);
    expect(t.vat).toBe(1200);
    expect(t.vatExemptTotal).toBe(0);
  });
});

describe("payableTotal — flat lines never lose VAT wrongly", () => {
  const q = (vatMode: string) => ({
    total: 26131,
    discountPct: 0,
    vatMode,
    classification: { vatExemptTotal: 14931 },
  });
  it("VAT-inclusive: client pays the gross ₱26,131", () => {
    expect(payableTotal(q("INCLUSIVE"))).toBe(26131);
  });
  it("VAT-exclusive (÷): client pays the net ₱24,931 (F&B net + KDK flat)", () => {
    expect(payableTotal(q("EXCLUSIVE"))).toBe(24931);
  });
});

/**
 * The owner, 2026-10-24, on 2026 - AFBM00003945J (zero-rated, 10% discount,
 * lines totalling ₱4,028,158.81): *"VAT Zero Rated means it has no VAT (same as
 * VAT Exclusive) but VAT Zero Rated can deduct EWT while VAT Exclusive cannot."*
 */
describe("VAT zero-rated — no VAT, like VAT Exclusive", () => {
  const q = (classification: unknown, vatMode = "ZERO_RATED") => ({
    total: 4_028_158.81, discountPct: 10, vatMode,
    classification,
  });
  const pricing = { pricing: { markupMode: "percent", markupValue: 0, discountMode: "percent", discountValue: 10 } };

  it("takes the VAT out of the entered prices: 4,028,158.81 ÷ 1.12 − 10% = 3,236,913.33", () => {
    expect(payableTotal(q(pricing))).toBeCloseTo(3_236_913.33, 2);
  });
  it("is the same figure as VAT Exclusive", () => {
    expect(payableTotal(q(pricing))).toBe(payableTotal(q(pricing, "EXCLUSIVE")));
  });
  it("an order the client already paid on before the change keeps its price (unpaid ones only)", () => {
    const paidBefore = { ...pricing, sale: { payments: [{ id: "p1", kind: "down", amount: 1_000_000, date: "2026-10-20" }] } };
    expect(payableTotal(q(paidBefore))).toBeCloseTo(3_625_342.93, 2);
    expect(zeroRatedKeepsGross(paidBefore)).toBe(true);
  });
  it("a payment dated from the change on doesn't bring the old price back", () => {
    const paidAfter = { ...pricing, sale: { payments: [{ id: "p1", kind: "down", amount: 1_000_000, date: "2026-10-25" }] } };
    expect(zeroRatedKeepsGross(paidAfter)).toBe(false);
    expect(payableTotal(q(paidAfter))).toBeCloseTo(3_236_913.33, 2);
  });
  it("only zero-rated keeps a gross basis that way; INCLUSIVE is gross, the exclusive modes never are", () => {
    expect(vatDisplayBasisIsGross("ZERO_RATED")).toBe(false);
    expect(vatDisplayBasisIsGross("ZERO_RATED", { zeroRatedGross: true })).toBe(true);
    expect(vatDisplayBasisIsGross("INCLUSIVE")).toBe(true);
    expect(vatDisplayBasisIsGross("EXCLUSIVE", { zeroRatedGross: true })).toBe(false);
  });
});

describe("VAT Exclusive +12% — 2026 - AFBM00004019J", () => {
  it("net 3,596,570.37 + 12% VAT 431,588.44 = 4,028,158.81 (unchanged)", () => {
    expect(payableTotal({ total: 4_028_158.81, discountPct: 0, vatMode: "EXCLUSIVE_PLUS", classification: {} })).toBeCloseTo(4_028_158.81, 2);
  });
});
