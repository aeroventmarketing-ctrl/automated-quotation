import { describe, it, expect } from "vitest";
import { joinDescription, wrapDescription, DESCRIPTION_ROW_CHARS, amountInWords, splitWords, receiptTotals, formLines, linesFromQuotation, receiptDate, NOTHING_FOLLOWS } from "./bir-receipts";

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
    expect(r.ok && r.value.drPages[0].at(-1)?.description).toBe(NOTHING_FOLLOWS);
  });
  it("more than 7: the invoice says 'As per' the PO for the total; the DR lists them all", () => {
    const r = formLines({ paymentOf: "PO No. 11014", lines: Array.from({ length: 9 }, (_, i) => line(i)) });
    expect(r.ok && r.value.si[0]).toEqual({ qty: 1, unit: "lot", description: "As per PO No. 11014", unitPrice: 900 });
    expect(r.ok && r.value.drPages).toEqual([[...Array.from({ length: 9 }, (_, i) => line(i)), expect.objectContaining({ description: NOTHING_FOLLOWS })]]);
  });
  it("the Delivery Receipt runs 13 lines a page; Nothing follows goes after the last line", () => {
    const r = formLines({ paymentOf: "", lines: Array.from({ length: 27 }, (_, i) => line(i)) });
    expect(r.ok && r.value.drPages.map((p) => p.length)).toEqual([13, 13, 2]);
    expect(r.ok && r.value.drPages[2][1].description).toBe(NOTHING_FOLLOWS);
    // A last page exactly full has no room for the marker.
    const full = formLines({ paymentOf: "", lines: Array.from({ length: 26 }, (_, i) => line(i)) });
    expect(full.ok && full.value.drPages.map((p) => p.length)).toEqual([13, 13]);
  });
  it("past ten pages is refused", () => {
    expect(formLines({ paymentOf: "", lines: Array.from({ length: 131 }, (_, i) => line(i)) }).ok).toBe(false);
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
      { qty: 2, unit: "Pcs", description: "Fan A / with motor", unitPrice: 450 },
      { qty: 1, unit: "Pcs", description: "Damper", unitPrice: 450 },
    ]);
  });
  it("dates print the template's way", () => {
    expect(receiptDate("2026-10-13")).toBe("October 13, 2026");
  });
});

describe("the description, from the quotation's Product Selection", () => {
  it("joins the detail lines with space-slash-space — the owner's KDK example", () => {
    expect(joinDescription("Ceiling Cassette\nKDK Brand\nModel: 24CHG")).toBe("Ceiling Cassette / KDK Brand / Model: 24CHG");
    expect(joinDescription("  A  \r\n\n  B  ")).toBe("A / B");
  });
  it("a row holds 48 characters; the rest continues on the next row, between words", () => {
    const text = "Centrifugal Blower / Model: CB-18 / 2HP 3PH 230V / Belt driven / Galvanized housing";
    const rows = wrapDescription(text);
    expect(rows.every((r) => r.length <= DESCRIPTION_ROW_CHARS)).toBe(true);
    expect(rows.join(" ")).toBe(text);
    expect(rows.length).toBe(2);
  });
  it("continuation rows carry only the description — no qty, unit or price", () => {
    const long = "Centrifugal Blower\nModel: CB-18\n2HP 3PH 230V\nBelt driven\nGalvanized housing";
    const [row1, row2] = wrapDescription(joinDescription(long));
    const ls = linesFromQuotation(
      [
        { qty: 2, lineTotal: 15374, description: "Ceiling Cassette\nKDK Brand\nModel: 24CHG" },
        { qty: 1, lineTotal: 1000, description: long },
      ],
      16374,
    );
    expect(ls.map((l) => [l.qty, l.unit, l.description, l.unitPrice])).toEqual([
      [2, "Pcs", "Ceiling Cassette / KDK Brand / Model: 24CHG", 7687],
      [1, "Pcs", row1, 1000],
      [null, "", row2, null],
    ]);
    expect(row1).toBe("Centrifugal Blower / Model: CB-18 / 2HP 3PH 230V");
    expect(row2).toBe("/ Belt driven / Galvanized housing");
  });
});
