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

/** Every sheet the workbook lists (the template's four, plus any DR copies), by name. */
async function parts(buf: Buffer | Uint8Array) {
  const zip = await JSZip.loadAsync(buf);
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const paths: Record<string, string> = {};
  for (const m of wb.matchAll(/<sheet name="([^"]+)"[^>]*r:id="(rId\d+)"/g)) {
    const target = new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`).exec(rels)![1];
    paths[m[1]] = `xl/${target}`;
  }
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

  it("refuses more than ten Delivery Receipt pages", async () => {
    const lines = Array.from({ length: 131 }, (_, i) => ({ qty: 1, unit: "pc", description: `Item ${i + 1}`, unitPrice: 1 }));
    await expect(fillReceiptsWorkbook(TEMPLATE, { ...sample, lines })).rejects.toThrow(/ten Delivery Receipt pages|10 Delivery Receipt pages/);
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

describe("the view it opens in", () => {
  it("every sheet opens in Page Break Preview at 120%; panes, selection and Normal zoom are the template's", async () => {
    const a = await parts(TEMPLATE);
    const b = await parts(await fillReceiptsWorkbook(TEMPLATE, sample));
    for (const name of Object.keys(a.sheets)) {
      const view = /<sheetView\b[^>]*>/.exec(b.sheets[name])![0];
      expect(view, name).toMatch(/\bview="pageBreakPreview"/);
      expect(view, name).toMatch(/\bzoomScale="120"/);
      expect(view, name).toMatch(/\bzoomScaleSheetLayoutView="120"/);
      const normalBefore = /zoomScaleNormal="(\d+)"/.exec(/<sheetView\b[^>]*>/.exec(a.sheets[name])![0])?.[1];
      expect(/zoomScaleNormal="(\d+)"/.exec(view)?.[1], name).toBe(normalBefore);
      // Everything after the <sheetView> tag inside <sheetViews> — panes, selection — unchanged.
      const inner = (x: string) => /<sheetView\b[^>]*>([\s\S]*?)<\/sheetView>/.exec(x)?.[1];
      expect(inner(b.sheets[name]), name).toBe(inner(a.sheets[name]));
    }
  });
});

describe("the owner's column adjustments", () => {
  it("SI column A is 8.4921875 stored — the 7.86 Excel shows (it was 7.54296875, shown as 6.91)", async () => {
    const { sheets } = await parts(await fillReceiptsWorkbook(TEMPLATE, sample));
    expect(sheets.SI).toContain('<col min="1" max="1" width="8.4921875" customWidth="1"/>');
  });
});

describe("a Delivery Receipt over several pages", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ qty: i + 1, unit: "pc", description: `Item ${i + 1}`, unitPrice: 10 }));

  it("13 lines a page: DR has lines 1–13, DR (2) the rest and Nothing follows", async () => {
    const out = await fillReceiptsWorkbook(TEMPLATE, { ...sample, lines: many(17) });
    const v = await cellValues(out);
    expect(v("DR", "C5")).toBe("Item 1");
    expect(v("DR", "C17")).toBe("Item 13");
    expect(v("DR", "C18")).toBeNull(); // rows 18–20 no longer carry lines
    expect(v("DR (2)", "C5")).toBe("Item 14");
    expect(v("DR (2)", "A8")).toBe(17);
    expect(v("DR (2)", "C9")).toBe("**** Nothing follows ****");
    expect(v("DR (2)", "C10")).toBeNull();
    // The header is the client's, on every page.
    expect(v("DR (2)", "B1")).toBe(sample.companyName);
    expect(v("DR (2)", "I1")).toBe(sample.date);
    expect(v("DR (2)", "B2")).toBe(sample.tin);
  });

  it("each extra page is the uploaded DR sheet's layout, printer settings and print area", async () => {
    const out = await fillReceiptsWorkbook(TEMPLATE, { ...sample, lines: many(30) });
    const a = await parts(TEMPLATE);
    const zip = await JSZip.loadAsync(out);
    const wb = await zip.file("xl/workbook.xml")!.async("string");
    expect([...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1])).toEqual(["Input", "SI", "DR", "DR (2)", "DR (3)", "CR"]);
    // Print areas follow their sheets: CR moved from index 3 to 5.
    expect(wb).toMatch(/localSheetId="5">CR!\$A\$1:\$M\$15</);
    expect(wb).toMatch(/localSheetId="2">DR!\$A\$1:\$K\$18</);
    expect(wb).toMatch(/localSheetId="3">'DR \(2\)'!\$A\$1:\$K\$18</);
    expect(wb).toMatch(/localSheetId="4">'DR \(3\)'!\$A\$1:\$K\$18</);
    const b = await parts(out);
    const pick = (x: string, re: RegExp) => x.match(re)?.join("\n") ?? "";
    for (const copy of ["DR (2)", "DR (3)"]) {
      const x = b.sheets[copy];
      expect(pick(x, /<cols>[\s\S]*?<\/cols>/g)).toBe(pick(a.sheets.DR, /<cols>[\s\S]*?<\/cols>/g));
      expect(pick(x, /<mergeCells[\s\S]*?<\/mergeCells>/g)).toBe(pick(a.sheets.DR, /<mergeCells[\s\S]*?<\/mergeCells>/g));
      expect(pick(x, /<pageMargins[^>]*>|<pageSetup[^>]*>|<sheetFormatPr[^>]*>/g)).toBe(pick(a.sheets.DR, /<pageMargins[^>]*>|<pageSetup[^>]*>|<sheetFormatPr[^>]*>/g));
      expect(pick(x, /<row [^>]*>/g)).toBe(pick(a.sheets.DR, /<row [^>]*>/g));
      expect(x).toMatch(/view="pageBreakPreview"/);
    }
    // Each copy has its own printer-settings part, a byte copy of DR's.
    const drBin = await zip.file("xl/printerSettings/printerSettings3.bin")!.async("uint8array");
    const relsFor = async (sheetPath: string) => zip.file(sheetPath.replace(/worksheets\/(sheet\d+\.xml)$/, "worksheets/_rels/$1.rels"))!.async("string");
    const bins = new Set<string>();
    for (const copy of ["DR (2)", "DR (3)"]) {
      const target = /printerSettings\/(printerSettings\d+\.bin)/.exec(await relsFor(b.paths[copy]))![1];
      bins.add(target);
      expect(Buffer.from(await zip.file(`xl/printerSettings/${target}`)!.async("uint8array")).equals(Buffer.from(drBin))).toBe(true);
    }
    expect(bins.size).toBe(2);
    expect(await zip.file("[Content_Types].xml")!.async("string")).toContain(b.paths["DR (3)"].replace(/^/, "/"));
    const app = await zip.file("docProps/app.xml")!.async("string");
    expect(app).toContain("<vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>6</vt:i4>");
    expect(app).toContain("<vt:lpstr>Named Ranges</vt:lpstr></vt:variant><vt:variant><vt:i4>5</vt:i4>");
    expect(app).toMatch(/<vt:vector size="11" baseType="lpstr"><vt:lpstr>Input<\/vt:lpstr><vt:lpstr>SI<\/vt:lpstr><vt:lpstr>DR<\/vt:lpstr><vt:lpstr>DR \(2\)<\/vt:lpstr><vt:lpstr>DR \(3\)<\/vt:lpstr><vt:lpstr>CR<\/vt:lpstr>/);
    const v = await cellValues(out);
    expect(v("DR (3)", "C5")).toBe("Item 27");
    expect(v("DR (3)", "C8")).toBe("Item 30");
    expect(v("DR (3)", "C9")).toBe("**** Nothing follows ****");
  });
});
