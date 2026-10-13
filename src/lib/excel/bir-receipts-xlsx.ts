/**
 * Fill Accounting's BIR receipts workbook (templates/bir-receipts-template.xlsx)
 * — Input → SI (Sales Invoice) · DR (Delivery Receipt) · CR (Collection Receipt).
 *
 * The owner: *"Make the uploaded file consistent, do not change the row height
 * and the column width."* The print sheets land on PRE-PRINTED BIR booklets, so
 * a millimetre of drift puts a figure in the wrong box. That rules out the usual
 * load-into-ExcelJS-and-save round trip: it rewrites every part of the package
 * and silently drops the four `printerSettings*.bin` parts, where the printer's
 * paper and tray for those booklets live.
 *
 * So this edits the workbook as a ZIP of XML and changes ONLY cell contents:
 *  - the Input sheet's values (the cells Accounting types into today);
 *  - the item rows on SI and DR, pointed at the Input lines with formulas, the
 *    way the template already does for its first rows — and CR's second
 *    amount-in-words line (G11, an empty merged row) at Input!B9;
 *  - every formula's cached result, computed here with the template's own
 *    formulas, so the right figures show even in a viewer that doesn't
 *    recalculate; and `fullCalcOnLoad`, so Excel recalculates anyway.
 * `<cols>`, every `<row …ht=…>`, merges, margins, page setup, styles, printer
 * settings — byte-for-byte the template's. A test holds it to that.
 */
import JSZip from "jszip";
import { formLines, amountInWords, receiptTotals, splitWords, type ReceiptInput, type ReceiptLine } from "@/lib/bir-receipts";

// --- XML helpers -------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const unesc = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

const colNum = (col: string) => col.split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0);
const colName = (n: number) => {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const splitRef = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Bad cell reference ${ref}`);
  return { col: m[1], row: Number(m[2]) };
};

type CellContent =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "formula"; formula: string }
  | { kind: "empty" };

/** One worksheet's XML, edited in place — cells only. */
class SheetXml {
  constructor(public xml: string) {}

  private rowRe(row: number) {
    return new RegExp(`<row r="${row}"([^>]*?)(/>|>([\\s\\S]*?)</row>)`);
  }

  /** Replace (or insert) one cell, keeping its style index. Nothing else moves. */
  set(ref: string, content: CellContent) {
    const { col, row } = splitRef(ref);
    const rowMatch = this.rowRe(row).exec(this.xml);
    const build = (style: string | null) => {
      const s = style ? ` s="${style}"` : "";
      switch (content.kind) {
        case "number":
          return `<c r="${ref}"${s}><v>${content.value}</v></c>`;
        case "string":
          return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(content.value)}</t></is></c>`;
        case "formula":
          return `<c r="${ref}"${s}><f>${esc(content.formula)}</f></c>`;
        default:
          return `<c r="${ref}"${s}/>`;
      }
    };
    if (!rowMatch) {
      // A row the template never wrote: add it, height-less (= the sheet default,
      // which is what an absent row already had), in row order.
      const cell = build(null);
      const sd = /<sheetData\/>|<sheetData>([\s\S]*?)<\/sheetData>/.exec(this.xml)!;
      if (sd[0] === "<sheetData/>") {
        this.xml = this.xml.replace("<sheetData/>", () => `<sheetData><row r="${row}">${cell}</row></sheetData>`);
        return;
      }
      const after = [...sd[1].matchAll(/<row r="(\d+)"/g)].find((m) => Number(m[1]) > row);
      const at = after ? sd.index + "<sheetData>".length + after.index! : sd.index + sd[0].length - "</sheetData>".length;
      this.xml = this.xml.slice(0, at) + `<row r="${row}">${cell}</row>` + this.xml.slice(at);
      return;
    }
    const [whole, attrs, tail, inner = ""] = rowMatch;
    const cellRe = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
    const existing = cellRe.exec(inner);
    let newInner: string;
    if (existing) {
      const style = /\bs="(\d+)"/.exec(existing[1])?.[1] ?? null;
      const built = build(style);
      newInner = inner.replace(existing[0], () => built);
    } else {
      const target = colNum(col);
      const next = [...inner.matchAll(/<c r="([A-Z]+)\d+"/g)].find((m) => colNum(m[1]) > target);
      const cell = build(null);
      newInner = next ? inner.slice(0, next.index) + cell + inner.slice(next.index) : inner + cell;
    }
    // A self-closing `<row …/>` opens up; its attributes (height!) are kept as is.
    void tail;
    const rebuilt = `<row r="${row}"${attrs}>${newInner}</row>`;
    this.xml = this.xml.replace(whole, () => rebuilt);
  }

  /** Every cell, as written. */
  cells(): { ref: string; attrs: string; body: string; raw: string }[] {
    return [...this.xml.matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)].map((m) => ({ ref: m[1], attrs: m[2], body: m[3] ?? "", raw: m[0] }));
  }
}

// --- A small evaluator for the template's formulas ----------------------------

type Val = number | string | null | { error: string };
const isErr = (v: Val): v is { error: string } => typeof v === "object" && v !== null;

/** Shift a shared formula's relative references by (dr, dc). The template uses no `$`. */
function shiftFormula(f: string, dr: number, dc: number): string {
  return f.replace(/((?:[A-Za-z_][\w.]*!)?)(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\w(])/g, (_m, sheet, cAbs, col, rAbs, row) => {
    const c = cAbs ? col : colName(colNum(col) + dc);
    const r = rAbs ? row : String(Number(row) + dr);
    return `${sheet}${cAbs}${c}${rAbs}${r}`;
  });
}

class Evaluator {
  private memo = new Map<string, Val>();
  private busy = new Set<string>();
  constructor(
    private values: Map<string, Val>,
    private formulas: Map<string, string>,
  ) {}

  get(sheet: string, ref: string): Val {
    const key = `${sheet}!${ref}`;
    if (this.memo.has(key)) return this.memo.get(key)!;
    const f = this.formulas.get(key);
    if (f == null) return this.values.get(key) ?? null;
    if (this.busy.has(key)) return { error: "#CIRC" };
    this.busy.add(key);
    let v: Val;
    try {
      v = this.evaluate(sheet, f);
    } catch {
      v = { error: "#PARSE" };
    }
    this.busy.delete(key);
    this.memo.set(key, v);
    return v;
  }

  private evaluate(sheet: string, formula: string): Val {
    const toks = formula.match(/#REF!|"(?:[^"]|"")*"|(?:[A-Za-z_][\w.]*!)?[A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?|\d+(?:\.\d+)?|[A-Z]+(?=\()|[-+*/(),]/g) ?? [];
    let i = 0;
    const peek = () => toks[i];
    const take = () => toks[i++];
    const n = (v: Val): number => (isErr(v) ? NaN : typeof v === "number" ? v : v == null || v === "" ? 0 : Number(v) || 0);
    const refVal = (tok: string): Val => {
      const bang = tok.lastIndexOf("!");
      const s = bang >= 0 ? tok.slice(0, bang) : sheet;
      return this.get(s, bang >= 0 ? tok.slice(bang + 1) : tok);
    };
    const rangeVals = (tok: string): Val[] => {
      const bang = tok.lastIndexOf("!");
      const s = bang >= 0 ? tok.slice(0, bang) : sheet;
      const [a, b] = (bang >= 0 ? tok.slice(bang + 1) : tok).split(":");
      const A = splitRef(a), Bq = splitRef(b);
      const out: Val[] = [];
      for (let r = Math.min(A.row, Bq.row); r <= Math.max(A.row, Bq.row); r++)
        for (let c = Math.min(colNum(A.col), colNum(Bq.col)); c <= Math.max(colNum(A.col), colNum(Bq.col)); c++) out.push(this.get(s, `${colName(c)}${r}`));
      return out;
    };
    const expr = (): Val => {
      let left = term();
      while (peek() === "+" || peek() === "-") {
        const op = take();
        const right = term();
        if (isErr(left)) return left;
        if (isErr(right)) return right;
        left = op === "+" ? n(left) + n(right) : n(left) - n(right);
      }
      return left;
    };
    const term = (): Val => {
      let left = factor();
      while (peek() === "*" || peek() === "/") {
        const op = take();
        const right = factor();
        if (isErr(left)) return left;
        if (isErr(right)) return right;
        left = op === "*" ? n(left) * n(right) : n(right) === 0 ? { error: "#DIV/0!" } : n(left) / n(right);
      }
      return left;
    };
    const factor = (): Val => {
      const t = take();
      if (t === undefined) throw new Error("end");
      if (t === "#REF!") return { error: "#REF!" };
      if (t === "-") {
        const v = factor();
        return isErr(v) ? v : -n(v);
      }
      if (t === "(") {
        const v = expr();
        take(); // ")"
        return v;
      }
      if (/^\d/.test(t)) return Number(t);
      if (t.startsWith('"')) return t.slice(1, -1).replace(/""/g, '"');
      if (t === "SUM") {
        take(); // "("
        let total = 0;
        while (peek() !== ")") {
          if (peek() === ",") { take(); continue; }
          const tok = peek()!;
          if (tok.includes(":")) {
            take();
            for (const v of rangeVals(tok)) {
              if (isErr(v)) return v;
              if (typeof v === "number") total += v;
            }
          } else {
            const v = expr();
            if (isErr(v)) return v;
            total += n(v);
          }
        }
        take(); // ")"
        return total;
      }
      if (/^[A-Z]+$/.test(t) && peek() === "(") throw new Error(`function ${t}`);
      return refVal(t);
    };
    const v = expr();
    // A bare reference to an empty cell shows as 0 in Excel.
    return v == null ? 0 : v;
  }
}

// --- The fill ---------------------------------------------------------------

const SHEETS = ["Input", "SI", "DR", "CR"] as const;
type SheetName = (typeof SHEETS)[number];

async function sheetPaths(zip: JSZip): Promise<Record<SheetName, string>> {
  const wb = await zip.file("xl/workbook.xml")!.async("string");
  const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
  const out = {} as Record<SheetName, string>;
  for (const name of SHEETS) {
    const rid = new RegExp(`<sheet[^>]*name="${name}"[^>]*r:id="(rId\\d+)"`).exec(wb)?.[1];
    const target = rid && new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
    if (!target) throw new Error(`The receipts template has no "${name}" sheet.`);
    out[name] = `xl/${target.replace(/^\/?xl\//, "")}`;
  }
  return out;
}

async function sharedStrings(zip: JSZip): Promise<string[]> {
  const f = zip.file("xl/sharedStrings.xml");
  if (!f) return [];
  const x = await f.async("string");
  return [...x.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => unesc(t[1])).join(""));
}

/** The Input sheet cell for each field (the template's "Input Details Here" column). */
const INPUT = {
  date: "B2", companyName: "B3", tin: "B4", address: "B5", businessStyle: "B6",
  amountWords1: "B8", amountWords2: "B9", paymentOf: "B10",
  vatRatePct: "B12", ewtRatePct: "B14", vatExemptSales: "B17", zeroRatedSales: "B18",
} as const;
const SI_INPUT_ROW = 3; // Input G3:J9 — the invoice's 7 lines
const DR_INPUT_ROW = 15; // Input G15:I30 — the delivery receipt's 16 lines
const SI_PRINT_ROW = 7; // SI rows 7–13
const DR_PRINT_ROW = 5; // DR rows 5–20

/**
 * Fill the template for one set of receipts. Returns the .xlsx bytes. Throws with
 * a readable reason when the lines don't fit the forms.
 */
export async function fillReceiptsWorkbook(template: ArrayBuffer | Buffer | Uint8Array, input: ReceiptInput): Promise<Buffer> {
  const laid = formLines(input);
  if (!laid.ok) throw new Error(laid.error);
  const { si, dr } = laid.value;

  const zip = await JSZip.loadAsync(template);
  const paths = await sheetPaths(zip);
  const sheets = {} as Record<SheetName, SheetXml>;
  for (const name of SHEETS) sheets[name] = new SheetXml(await zip.file(paths[name])!.async("string"));
  const inp = sheets.Input;

  // Amount in words — of the Net Collectible (what CR prints), unless typed.
  const totals = receiptTotals({ lines: si, vatRatePct: input.vatRatePct, ewtRatePct: input.ewtRatePct });
  const [w1, w2] = input.amountWords1.trim()
    ? [input.amountWords1.trim(), input.amountWords2.trim()]
    : splitWords(amountInWords(totals.netCollectible));

  const str = (ref: string, v: string) => inp.set(ref, v.trim() ? { kind: "string", value: v.trim() } : { kind: "empty" });
  const numOrEmpty = (sheet: SheetXml, ref: string, v: number | null) =>
    sheet.set(ref, v != null && Number.isFinite(v) ? { kind: "number", value: v } : { kind: "empty" });
  str(INPUT.date, input.date);
  str(INPUT.companyName, input.companyName);
  str(INPUT.tin, input.tin);
  str(INPUT.address, input.address);
  str(INPUT.businessStyle, input.businessStyle);
  str(INPUT.amountWords1, w1);
  str(INPUT.amountWords2, w2);
  str(INPUT.paymentOf, input.paymentOf);
  numOrEmpty(inp, INPUT.vatRatePct, input.vatRatePct);
  numOrEmpty(inp, INPUT.ewtRatePct, input.ewtRatePct);
  numOrEmpty(inp, INPUT.vatExemptSales, input.vatExemptSales);
  numOrEmpty(inp, INPUT.zeroRatedSales, input.zeroRatedSales);

  const writeLine = (row: number, l: ReceiptLine | undefined, withPrice: boolean) => {
    numOrEmpty(inp, `G${row}`, l?.qty ?? null);
    str(`H${row}`, l?.unit ?? "");
    str(`I${row}`, l?.description ?? "");
    if (withPrice) numOrEmpty(inp, `J${row}`, l?.unitPrice ?? null);
  };
  for (let i = 0; i < 7; i++) writeLine(SI_INPUT_ROW + i, si[i], true);
  for (let i = 0; i < 16; i++) writeLine(DR_INPUT_ROW + i, dr[i], false);

  // The print rows read the Input lines — a formula where the line has
  // something to print, an empty (still-styled) cell where it doesn't, so no
  // stray "0" lands on the booklet.
  const point = (sheet: SheetXml, ref: string, inputRef: string, has: boolean) =>
    sheet.set(ref, has ? { kind: "formula", formula: `Input!${inputRef}` } : { kind: "empty" });
  for (let i = 0; i < 7; i++) {
    const l = si[i];
    const r = SI_PRINT_ROW + i, ir = SI_INPUT_ROW + i;
    point(sheets.SI, `A${r}`, `G${ir}`, l?.qty != null);
    point(sheets.SI, `B${r}`, `H${ir}`, !!l?.unit);
    point(sheets.SI, `C${r}`, `I${ir}`, !!l?.description);
    point(sheets.SI, `J${r}`, `J${ir}`, l?.unitPrice != null);
    point(sheets.SI, `K${r}`, `K${ir}`, l?.unitPrice != null && l?.qty != null);
  }
  for (let i = 0; i < 16; i++) {
    const l = dr[i];
    const r = DR_PRINT_ROW + i, ir = DR_INPUT_ROW + i;
    point(sheets.DR, `A${r}`, `G${ir}`, l?.qty != null);
    point(sheets.DR, `B${r}`, `H${ir}`, !!l?.unit);
    point(sheets.DR, `C${r}`, `I${ir}`, !!l?.description);
  }
  // CR's second words line — an empty merged row (G11:M11) the template left unwired.
  point(sheets.CR, "G11", "B9", !!w2);

  // Cache every formula's result.
  const shared = await sharedStrings(zip);
  const values = new Map<string, Val>();
  const formulas = new Map<string, string>();
  for (const name of SHEETS) {
    const masters = new Map<string, { text: string; ref: string }>();
    const cells = sheets[name].cells();
    for (const c of cells) {
      const f = /<f([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(c.body);
      if (f && /t="shared"/.test(f[1]) && f[2]) masters.set(/si="(\d+)"/.exec(f[1])![1], { text: unesc(f[2]), ref: c.ref });
    }
    for (const c of cells) {
      const key = `${name}!${c.ref}`;
      const f = /<f([^>]*?)(?:\/>|>([\s\S]*?)<\/f>)/.exec(c.body);
      if (f) {
        if (f[2]) formulas.set(key, unesc(f[2]));
        else {
          const m = masters.get(/si="(\d+)"/.exec(f[1])?.[1] ?? "");
          if (m) {
            const a = splitRef(m.ref), b = splitRef(c.ref);
            formulas.set(key, shiftFormula(m.text, b.row - a.row, colNum(b.col) - colNum(a.col)));
          }
        }
        continue;
      }
      const t = /\bt="(\w+)"/.exec(c.attrs)?.[1];
      const v = /<v[^>]*>([\s\S]*?)<\/v>/.exec(c.body)?.[1];
      if (t === "inlineStr") values.set(key, unesc([...c.body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join("")));
      else if (t === "s" && v != null) values.set(key, shared[Number(v)] ?? "");
      else if ((t === "str" || t === "e") && v != null) values.set(key, unesc(v));
      else if (v != null) values.set(key, Number(v));
    }
  }
  const ev = new Evaluator(values, formulas);
  for (const name of SHEETS) {
    const sh = sheets[name];
    for (const c of sh.cells()) {
      const fm = /<f[^>]*?(?:\/>|>[\s\S]*?<\/f>)/.exec(c.body);
      if (!fm) continue;
      const v = ev.get(name, c.ref);
      if (isErr(v)) continue; // leave the template's own cached error (#REF! in a side note)
      const style = /\bs="(\d+)"/.exec(c.attrs)?.[1];
      const s = style ? ` s="${style}"` : "";
      const cell =
        typeof v === "string"
          ? `<c r="${c.ref}"${s} t="str">${fm[0]}<v>${esc(v)}</v></c>`
          : `<c r="${c.ref}"${s}>${fm[0]}<v>${v ?? 0}</v></c>`;
      sh.xml = sh.xml.replace(c.raw, () => cell);
    }
  }
  // `createFolders: false` keeps the package's entry list the template's — no stray
  // directory entries that a strict reader might trip on.
  for (const name of SHEETS) zip.file(paths[name], sheets[name].xml, { createFolders: false });

  // Recalculate on open, and drop the calc chain (Excel rebuilds it) — the
  // chain lists formula cells, and the print rows now have a different set.
  const wbXml = await zip.file("xl/workbook.xml")!.async("string");
  zip.file(
    "xl/workbook.xml",
    /<calcPr[^>]*fullCalcOnLoad/.test(wbXml) ? wbXml : wbXml.replace(/<calcPr([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>'),
    { createFolders: false },
  );
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const ct = await zip.file("[Content_Types].xml")!.async("string");
    zip.file("[Content_Types].xml", ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, () => ""), { createFolders: false });
    const rels = await zip.file("xl/_rels/workbook.xml.rels")!.async("string");
    zip.file("xl/_rels/workbook.xml.rels", rels.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, ""), { createFolders: false });
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Exposed for the test that checks the evaluator against Excel's own cache. */
export const __test = { SheetXml, Evaluator, shiftFormula, sheetPaths, sharedStrings };
