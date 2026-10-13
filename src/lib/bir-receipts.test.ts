import { describe, it, expect } from "vitest";
import { amountInWords, splitWords, receiptTotals, formLines, linesFromQuotation, receiptDate, NOTHING_FOLLOWS } from "./bir-receipts";

describe("amount in words — the template's wording", () => {
  it("matches the sample: 6,937.50", () => {
    expect(amountInWords(6937.5)).toBe("Six Thousand Nine Hundred Thirty Seven & 50/100");
  });
  it("teens, round tens, millions, zero centavos, zero pesos", () => {
    expect(amountInWords(1_215_013.05)).toBe("One Million Two Hundred Fifteen Thousand Thirteen & 05/100");
    expect(amountInWords(40)).toBe("Forty & 00/100");
    expect(amountInWords(0.75)).toBe("Zero & 75/100");
  });
  it("splits over the two lines between words", () => {
    const [a, b] = splitWords("One Million Two Hundred Fifteen Thousand Three Hundred Thirteen & 05/100", 40);
    expect(a.length).toBeLessThanOrEqual(40);
    expect(`${a} ${b}`).toBe("One Million Two Hundred Fifteen Thousand Three Hundred Thirteen & 05/100");
  });
});

describe("totals — the template's own formulas", () => {
  it("reproduces the sample: 7,000 → VAT 750, EWT 62.50, net 6,937.50", () => {
    const t = receiptTotals({ vatRatePct: 12, ewtRatePct: 1, lines: [{ qty: 300, unit: "", description: "a", unitPrice: 10 }, { qty: 500, unit: "", description: "b", unitPrice: 8 }] });
    expect(t).toEqual({ totalSales: 7000, lessVat: 750, lessEwt: 62.5, netCollectible: 6937.5, vatableSales: 6250 });
  });
});

describe("the lines on each form", () => {
  const line = (i: number) => ({ qty: 1, unit: "pc", description: `Item ${i}`, unitPrice: 100 });
  it("up to 7: on both forms, then Nothing follows", () => {
    const r = formLines({ paymentOf: "PO No. 1", lines: [line(1), line(2)] });
    expect(r.ok && r.value.si.map((l) => l.description)).toEqual(["Item 1", "Item 2", NOTHING_FOLLOWS]);
    expect(r.ok && r.value.siSummarised).toBe(false);
  });
  it("exactly 7: no room for the marker on the invoice", () => {
    const r = formLines({ paymentOf: "", lines: Array.from({ length: 7 }, (_, i) => line(i)) });
    expect(r.ok && r.value.si).toHaveLength(7);
    expect(r.ok && r.value.dr.at(-1)?.description).toBe(NOTHING_FOLLOWS);
  });
  it("8 to 16: the invoice says 'As per' the PO for the total; the DR lists them all", () => {
    const r = formLines({ paymentOf: "PO No. 11014", lines: Array.from({ length: 9 }, (_, i) => line(i)) });
    expect(r.ok && r.value.si[0]).toEqual({ qty: 1, unit: "lot", description: "As per PO No. 11014", unitPrice: 900 });
    expect(r.ok && r.value.dr).toHaveLength(10);
  });
  it("blank editor rows aren't lines; none at all is refused", () => {
    expect(formLines({ paymentOf: "", lines: [{ qty: null, unit: "", description: " ", unitPrice: null }] }).ok).toBe(false);
  });
});

describe("prefill from an order", () => {
  it("spreads the payable over the lines and lands exactly on it", () => {
    const ls = linesFromQuotation(
      [{ qty: 2, lineTotal: 1000, description: "Fan A\nwith motor" }, { qty: 1, lineTotal: 500, description: "Damper" }],
      1350, // a 10% discount off 1,500
    );
    expect(ls).toEqual([
      { qty: 2, unit: "Pcs", description: "Fan A", unitPrice: 450 },
      { qty: 1, unit: "Pcs", description: "Damper", unitPrice: 450 },
    ]);
  });
  it("dates print the template's way", () => {
    expect(receiptDate("2026-10-13")).toBe("October 13, 2026");
  });
});
