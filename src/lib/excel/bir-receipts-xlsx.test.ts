/**
 * The receipts workbook — held to the owner's rule: *"Make the uploaded file
 * consistent, do not change the row height and the column width."*
 *
 * Three things are asserted against the real template:
 *  1. the layout parts are byte-identical (cols, every row's attributes, merges,
 *     margins, page setup, styles, printer settings);
 *  2. the evaluator, run on the untouched template, reproduces the values Excel
 *     itself cached — so the figures this module caches are Excel's figures;
 *  3. a filled workbook says what the form said, on all three receipts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import JSZip from "jszip";
import { fillReceiptsWorkbook, __test } from "./bir-receipts-xlsx";
import type { ReceiptInput } from "@/lib/bir-receipts";

const TEMPLATE = readFileSync(path.join(process.cwd(), "templates/bir-receipts-template.xlsx"));

const sample: ReceiptInput = {
  date: "October 13, 2026",
  companyName: "TRUE-TEMP CORPORATION",
  tin: "216-506-486-00000",
  address: "27A National Highway, Platero, Biñan City, Laguna",
  businessStyle: "",
  paymentOf: "PO No. 11014",
  amountWords1: "",
  amountWords2: "",
  vatRatePct: 12,
  ewtRatePct: 1,
  vatExemptSales: 0,
  zeroRatedSales: 0,
  lines: [
    { qty: 300, unit: "Pcs", description: '6" TDC Cleat Material: G.I.', unitPrice: 10 },
    { qty: 500, unit: "Pcs", description: "Angle Corner Material:G.I. / GA20", unitPrice: 8 },
  ],
};

async function parts(buf: Buffer | Uint8Array) {
  const zip = await JSZip.loadAsync(buf);
  const paths = await __test.sheetPaths(zip);
  const sheets: Record<string, string> = {};
  for (const [name, p] of Object.entries(paths)) sheets[name] = await zip.file(p)!.async("string");
  return { zip, paths, sheets };
}

/** The value a cell holds after the fill — cached result or literal. */
async function cellValues(buf: Buffer) {
  const { zip, sheets } = await parts(buf);
  const shared = await __test.sharedStrings(zip);
  return (sheet: string, ref: string): string | number | null => {
    const x = sheets[sheet];
    const m = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`).exec(x);
    if (!m) return null;
    const body = m[2] ?? "";
    const t = /\bt="(\w+)"/.exec(m[1])?.[1];
    const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
    if (t === "inlineStr") return [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((q) => q[1]).join("").replace(/&amp;/g, "&");
    if (t === "s") return shared[Number(v)];
    if (t === "str") return (v ?? "").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
    return v == null ? null : Number(v);
  };
}

describe("the layout is the template's, byte for byte", () => {
  it("columns, row heights, merges, margins, page setup, styles and printer settings are untouched", async () => {
    const out = await fillReceiptsWorkbook(TEMPLATE, sample);
    const a = await parts(TEMPLATE);
    const b = await parts(out);
    for (const name of Object.keys(a.sheets)) {
      const pick = (x: string, re: RegExp) => x.match(re)?.join("\n") ?? "";
      expect(pick(b.sheets[name], /<cols>[\s\S]*?<\/cols>/g), `${name} <cols>`).toBe(pick(a.sheets[name], /<cols>[\s\S]*?<\/cols>/g));
      expect(pick(b.sheets[name], /<mergeCells[\s\S]*?<\/mergeCells>/g), `${name} merges`).toBe(pick(a.sheets[name], /<mergeCells[\s\S]*?<\/mergeCells>/g));
      expect(pick(b.sheets[name], /<pageMargins[^>]*>|<pageSetup[^>]*>|<sheetFormatPr[^>]*>|<printOptions[^>]*>/g), `${name} page`).toBe(
        pick(a.sheets[name], /<pageMargins[^>]*>|<pageSetup[^>]*>|<sheetFormatPr[^>]*>|<printOptions[^>]*>/g),
      );
      // Every row the template has keeps its exact opening tag (ht, customHeight, style…).
      const rowsA: string[] = a.sheets[name].match(/<row [^>]*>/g) ?? [];
      const rowsB = new Set<string>(b.sheets[name].match(/<row [^>]*>/g) ?? []);
      for (const r of rowsA) expect(rowsB.has(r.replace(/\/>$/, ">")) || rowsB.has(r), `${name} ${r}`).toBe(true);
      // …and any row added carries no height of its own.
      for (const r of rowsB) if (!rowsA.includes(r) && !rowsA.includes(r.replace(/>$/, "/>"))) expect(r).not.toMatch(/\bht=/);
    }
    for (const f of ["xl/styles.xml", "xl/theme/theme1.xml", "xl/printerSettings/printerSettings1.bin", "xl/printerSettings/printerSettings2.bin", "xl/printerSettings/printerSettings3.bin", "xl/printerSettings/printerSettings4.bin"]) {
      const x = await a.zip.file(f)!.async("uint8array");
      const y = await b.zip.file(f)?.async("uint8array");
      expect(y && Buffer.from(y).equals(Buffer.from(x)), f).toBe(true);
    }
  });
});

describe("the evaluator agrees with Excel", () => {
  it("re-computing the untouched template reproduces every value Excel cached", async () => {
    // Fill with the template's OWN sample — the same figures Excel cached — and
    // compare the formula cells we re-cached with the original cache.
    const out = await fillReceiptsWorkbook(TEMPLATE, sample);
    const before = await cellValues(TEMPLATE);
    const after = await cellValues(out);
    const checks: [string, string][] = [
      ["Input", "K3"], ["Input", "K4"], ["Input", "K10"], ["Input", "B11"], ["Input", "B13"], ["Input", "B15"], ["Input", "B16"], ["Input", "B7"],
      ["SI", "B1"], ["SI", "B2"], ["SI", "E3"], ["SI", "A7"], ["SI", "C7"], ["SI", "J7"], ["SI", "K7"], ["SI", "K8"], ["SI", "K14"], ["SI", "K15"], ["SI", "K16"], ["SI", "E16"], ["SI", "E19"], ["SI", "K20"],
      ["DR", "B1"], ["DR", "I1"], ["DR", "B2"], ["DR", "B3"], ["DR", "A5"], ["DR", "C6"],
      ["CR", "L4"], ["CR", "B5"], ["CR", "B6"], ["CR", "B7"], ["CR", "I5"], ["CR", "F7"], ["CR", "L8"], ["CR", "G10"], ["CR", "L12"], ["CR", "B13"], ["CR", "G14"],
    ];
    for (const [s, r] of checks) {
      const x = before(s, r), y = after(s, r);
      if (typeof x === "number") expect(y as number, `${s}!${r}`).toBeCloseTo(x, 6);
      else expect(String(y).trim(), `${s}!${r}`).toBe(String(x).trim());
    }
  });
});

describe("a filled workbook", () => {
  it("prints the form's figures on all three receipts, with Nothing follows after the last line", async () => {
    const out = await fillReceiptsWorkbook(TEMPLATE, {
      ...sample,
      companyName: "MODAIR MANILA CO. LTD. INC",
      tin: "001-797-807-000",
      businessStyle: "Modair Manila Co., Ltd. Inc.",
      paymentOf: "PO No. 5512",
      lines: [{ qty: 2, unit: "unit", description: "Centrifugal blower 2HP", unitPrice: 56000 }],
    });
    const v = await cellValues(out);
    expect(v("SI", "B1")).toBe("MODAIR MANILA CO. LTD. INC");
    expect(v("SI", "C7")).toBe("Centrifugal blower 2HP");
    expect(v("SI", "B7")).toBe("unit");
    expect(v("SI", "K7")).toBe(112000);
    expect(v("SI", "C8")).toBe("**** Nothing follows ****");
    expect(v("SI", "A9")).toBeNull(); // nothing printed on an unused row
    expect(v("SI", "K14")).toBe(112000);
    expect(v("SI", "K15")).toBeCloseTo(12000, 6);
    expect(v("DR", "C5")).toBe("Centrifugal blower 2HP");
    expect(v("DR", "C6")).toBe("**** Nothing follows ****");
    expect(v("CR", "B7")).toBeCloseTo(111000, 6); // 112,000 − 1% of 100,000
    expect(v("CR", "G10")).toBe("One Hundred Eleven Thousand & 00/100");
    expect(v("CR", "G14")).toBe("PO No. 5512");
    expect(v("CR", "F8")).toBe("Modair Manila Co., Ltd. Inc.");
  });

  it("asks Excel to recalculate on open and drops the stale calc chain", async () => {
    const { zip } = await parts(await fillReceiptsWorkbook(TEMPLATE, sample));
    expect(await zip.file("xl/workbook.xml")!.async("string")).toMatch(/<calcPr[^>]*fullCalcOnLoad="1"/);
    expect(zip.file("xl/calcChain.xml")).toBeNull();
    expect(await zip.file("[Content_Types].xml")!.async("string")).not.toMatch(/calcChain/);
  });

  it("text with special characters survives (XML-escaped, and a literal $& stays literal)", async () => {
    const v = await cellValues(await fillReceiptsWorkbook(TEMPLATE, { ...sample, lines: [{ qty: 1, unit: "lot", description: 'Fan & motor <2HP> "A" $& co', unitPrice: 5 }] }));
    expect(v("Input", "I3")).toContain('Fan & motor');
    expect(v("SI", "C7")).toBe('Fan & motor <2HP> "A" $& co'.replace(/<|>/g, (m) => (m === "<" ? "&lt;" : "&gt;")));
  });

  it("refuses more lines than a Delivery Receipt holds", async () => {
    const lines = Array.from({ length: 17 }, (_, i) => ({ qty: 1, unit: "pc", description: `Item ${i + 1}`, unitPrice: 1 }));
    await expect(fillReceiptsWorkbook(TEMPLATE, { ...sample, lines })).rejects.toThrow(/16/);
  });
});

describe("the package", () => {
  it("has exactly the template's parts, minus the calc chain — no stray folder entries", async () => {
    const a = await JSZip.loadAsync(TEMPLATE);
    const b = await JSZip.loadAsync(await fillReceiptsWorkbook(TEMPLATE, sample));
    const names = (z: JSZip) => Object.keys(z.files).sort();
    expect(names(b)).toEqual(names(a).filter((n) => n !== "xl/calcChain.xml"));
  });
});
