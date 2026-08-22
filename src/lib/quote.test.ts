import { describe, it, expect } from "vitest";
import { computeTotals, payableTotal, isFlatVatLine } from "@/lib/quote";

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
