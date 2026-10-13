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
import { formLines, amountInWords, receiptTotals, splitWords, DR_LINES_PER_PAGE, type ReceiptInput, type ReceiptLine } from "@/lib/bir-receipts";

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

// --- The view the file opens in -----------------------------------------------

/** The zoom the downloaded workbook opens at, in Page Break Preview. */
export const PAGE_BREAK_ZOOM = 120;

/**
 * Set a sheet's first `<sheetView>` to Page Break Preview at `zoom`%. Excel reads
 * `zoomScale` as the zoom on open and `zoomScaleSheetLayoutView` as Page Break
 * Preview's own remembered zoom, so both are set; `zoomScaleNormal` (Normal
 * view's zoom) is left as the template has it.
 */
export function withPageBreakView(xml: string, zoom: number): string {
  return xml.replace(/<sheetView\b([^>]*?)(\/?)>/, (_m, attrs: string, selfClose: string) => {
    let a = attrs;
    const setAttr = (name: string, value: string) => {
      const re = new RegExp(`\\s${name}="[^"]*"`);
      a = re.test(a) ? a.replace(re, ` ${name}="${value}"`) : `${a} ${name}="${value}"`;
    };
    setAttr("view", "pageBreakPreview");
    setAttr("zoomScale", String(zoom));
    setAttr("zoomScaleSheetLayoutView", String(zoom));
    return `<sheetView${a}${selfClose}>`;
  });
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
const DR_PRINT_ROW = 5; // DR rows 5–20 — 13 lines print (5–17); 18–20 stay empty
const DR_TEMPLATE_ROWS = 16; // the item rows the template has on DR (and Input G15:I30)

/**
 * Fill the template for one set of receipts. Returns the .xlsx bytes. Throws with
 * a readable reason when the lines don't fit the forms.
 */
export async function fillReceiptsWorkbook(template: ArrayBuffer | Buffer | Uint8Array, input: ReceiptInput): Promise<Buffer> {
  const laid = formLines(input);
  if (!laid.ok) throw new Error(laid.error);
  const { si, drPages } = laid.value;
  const dr = drPages[0];

  const zip = await JSZip.loadAsync(template);
  const paths = await sheetPaths(zip);
  const sheets = {} as Record<SheetName, SheetXml>;
  for (const name of SHEETS) sheets[name] = new SheetXml(await zip.file(paths[name])!.async("string"));
  // The DR sheet as uploaded — each further Delivery Receipt page is a copy of it.
  const drTemplateXml = sheets.DR.xml;
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
  // Input holds the first DR page (13 lines); its last three DR rows stay empty.
  for (let i = 0; i < DR_TEMPLATE_ROWS; i++) writeLine(DR_INPUT_ROW + i, i < DR_LINES_PER_PAGE ? dr[i] : undefined, false);

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
  for (let i = 0; i < DR_TEMPLATE_ROWS; i++) {
    const l = i < DR_LINES_PER_PAGE ? dr[i] : undefined;
    const r = DR_PRINT_ROW + i, ir = DR_INPUT_ROW + i;
    point(sheets.DR, `A${r}`, `G${ir}`, l?.qty != null);
    point(sheets.DR, `B${r}`, `H${ir}`, !!l?.unit);
    point(sheets.DR, `C${r}`, `I${ir}`, !!l?.description);
  }
  // CR's second words line — an empty merged row (G11:M11) the template left unwired.
  point(sheets.CR, "G11", "B9", !!w2);

  // Delivery Receipt pages 2, 3… — copies of the uploaded DR sheet: the same
  // header (client, date, TIN, address — still read from Input) and the next 13
  // lines, written as values (Input holds one page).
  const extraDr: { name: string; sx: SheetXml }[] = drPages.slice(1).map((page, k) => {
    const sx = new SheetXml(drTemplateXml);
    for (let i = 0; i < DR_TEMPLATE_ROWS; i++) {
      const l = i < DR_LINES_PER_PAGE ? page[i] : undefined;
      const r = DR_PRINT_ROW + i;
      numOrEmpty(sx, `A${r}`, l?.qty ?? null);
      sx.set(`B${r}`, l?.unit?.trim() ? { kind: "string", value: l.unit.trim() } : { kind: "empty" });
      sx.set(`C${r}`, l?.description?.trim() ? { kind: "string", value: l.description.trim() } : { kind: "empty" });
    }
    return { name: `DR (${k + 2})`, sx };
  });
  const all: { name: string; sx: SheetXml }[] = [...SHEETS.map((name) => ({ name, sx: sheets[name] })), ...extraDr];

  // Cache every formula's result.
  const shared = await sharedStrings(zip);
  const values = new Map<string, Val>();
  const formulas = new Map<string, string>();
  for (const { name, sx } of all) {
    const masters = new Map<string, { text: string; ref: string }>();
    const cells = sx.cells();
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
  for (const { name, sx } of all) {
    for (const c of sx.cells()) {
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
      sx.xml = sx.xml.replace(c.raw, () => cell);
    }
  }
  // Open every sheet in Page Break Preview at 120% — the owner: *"default the
  // downloaded excel file to Page Break view 120%"*. Only the <sheetView> tag's
  // view/zoom attributes change: panes, selection, the Normal-view zoom, and
  // every width, height and print setting stay the template's.
  for (const { sx } of all) sx.xml = withPageBreakView(sx.xml, PAGE_BREAK_ZOOM);
  // `createFolders: false` keeps the package's entry list the template's — no stray
  // directory entries that a strict reader might trip on.
  for (const name of SHEETS) zip.file(paths[name], sheets[name].xml, { createFolders: false });
  if (extraDr.length) await addSheetCopies(zip, "DR", paths.DR, extraDr.map(({ name, sx }) => ({ name, xml: sx.xml })));

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

/**
 * Add copies of one sheet to the package, straight after it in the tab order:
 * the sheet part, its relationships (with its OWN byte copy of the source
 * sheet's printer settings — paper and tray for that booklet), the content
 * type, the workbook entry, and the source's print area. Sheet-scoped names
 * after the insertion point are re-indexed, so CR's print area still means CR.
 */
async function addSheetCopies(zip: JSZip, sourceName: string, sourcePath: string, copies: { name: string; xml: string }[]) {
  const put = (path: string, data: string | Uint8Array) => zip.file(path, data, { createFolders: false });
  const read = async (path: string) => (await zip.file(path)?.async("string")) ?? "";
  const highest = (re: RegExp) => Math.max(0, ...Object.keys(zip.files).map((f) => Number(re.exec(f)?.[1] ?? 0)));

  let wb = await read("xl/workbook.xml");
  let wbRels = await read("xl/_rels/workbook.xml.rels");
  let ct = await read("[Content_Types].xml");
  const srcRels = await read(sourcePath.replace(/worksheets\/(sheet\d+\.xml)$/, "worksheets/_rels/$1.rels"));
  const srcBin = /Target="\.\.\/printerSettings\/(printerSettings\d+\.bin)"/.exec(srcRels)?.[1];
  const binBytes = srcBin ? await zip.file(`xl/printerSettings/${srcBin}`)?.async("uint8array") : undefined;

  const sheetEls = [...wb.matchAll(/<sheet\b[^>]*\/>/g)];
  const srcIdx = sheetEls.findIndex((m) => m[0].includes(`name="${sourceName}"`));
  if (srcIdx < 0) throw new Error(`No "${sourceName}" sheet to copy.`);
  const srcArea = new RegExp(`<definedName name="_xlnm\\.Print_Area" localSheetId="${srcIdx}">([^<]*)</definedName>`).exec(wb)?.[1];

  let sheetNo = highest(/^xl\/worksheets\/sheet(\d+)\.xml$/);
  let binNo = highest(/^xl\/printerSettings\/printerSettings(\d+)\.bin$/);
  let sheetId = Math.max(...sheetEls.map((m) => Number(/sheetId="(\d+)"/.exec(m[0])![1])));
  let rId = Math.max(...[...wbRels.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1])));

  // Sheet-scoped names after the source move up by the number of copies.
  wb = wb.replace(/localSheetId="(\d+)"/g, (m, n) => (Number(n) > srcIdx ? `localSheetId="${Number(n) + copies.length}"` : m));

  let insertAt = sheetEls[srcIdx].index! + sheetEls[srcIdx][0].length;
  const names: string[] = [];
  copies.forEach((copy, k) => {
    const path = `xl/worksheets/sheet${++sheetNo}.xml`;
    put(path, copy.xml);
    let rels = srcRels;
    if (srcBin && binBytes) {
      const bin = `printerSettings${++binNo}.bin`;
      put(`xl/printerSettings/${bin}`, binBytes);
      rels = rels.replace(srcBin, bin);
    }
    if (rels) put(`xl/worksheets/_rels/sheet${sheetNo}.xml.rels`, rels);
    wbRels = wbRels.replace("</Relationships>", () => `<Relationship Id="rId${++rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNo}.xml"/></Relationships>`);
    ct = ct.replace("</Types>", () => `<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    const el = `<sheet name="${esc(copy.name)}" sheetId="${++sheetId}" r:id="rId${rId}"/>`;
    wb = wb.slice(0, insertAt) + el + wb.slice(insertAt);
    insertAt += el.length;
    if (srcArea) {
      const area = srcArea.replace(/^('?)[^!]*\1!/, `'${copy.name.replace(/'/g, "''")}'!`);
      names.push(`<definedName name="_xlnm.Print_Area" localSheetId="${srcIdx + k + 1}">${esc(area)}</definedName>`);
    }
  });
  if (names.length) {
    wb = wb.includes("</definedNames>")
      ? wb.replace("</definedNames>", () => `${names.join("")}</definedNames>`)
      : wb.replace("</sheets>", () => `</sheets><definedNames>${names.join("")}</definedNames>`);
  }
  if (binBytes && !/Extension="bin"/.test(ct)) {
    ct = ct.replace("<Default ", () => `<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/><Default `);
  }
  put("xl/workbook.xml", wb);
  put("xl/_rels/workbook.xml.rels", wbRels);
  put("[Content_Types].xml", ct);

  // The document properties list the sheets and named ranges by title. Excel
  // rebuilds the list on save; keep it true until then. Skipped if its shape
  // isn't the one Excel writes.
  const app = await read("docProps/app.xml");
  const sheetCount = /<vt:lpstr>Worksheets<\/vt:lpstr><\/vt:variant><vt:variant><vt:i4>(\d+)<\/vt:i4>/.exec(app);
  const titles = /<TitlesOfParts><vt:vector size="(\d+)" baseType="lpstr">([\s\S]*?)<\/vt:vector><\/TitlesOfParts>/.exec(app);
  if (sheetCount && titles) {
    const n = Number(sheetCount[1]);
    const entries = [...titles[2].matchAll(/<vt:lpstr>[\s\S]*?<\/vt:lpstr>/g)].map((m) => m[0]);
    const sheetTitles = entries.slice(0, n);
    const at = sheetTitles.findIndex((t) => t === `<vt:lpstr>${sourceName}</vt:lpstr>`);
    if (at >= 0) {
      sheetTitles.splice(at + 1, 0, ...copies.map((c) => `<vt:lpstr>${esc(c.name)}</vt:lpstr>`));
      const ranges = [...entries.slice(n), ...(srcArea ? copies.map((c) => `<vt:lpstr>'${esc(c.name)}'!Print_Area</vt:lpstr>`) : [])];
      const namedCount = /<vt:lpstr>Named Ranges<\/vt:lpstr><\/vt:variant><vt:variant><vt:i4>(\d+)<\/vt:i4>/;
      let next = app
        .replace(sheetCount[0], () => sheetCount[0].replace(`<vt:i4>${n}</vt:i4>`, `<vt:i4>${n + copies.length}</vt:i4>`))
        .replace(titles[0], () => `<TitlesOfParts><vt:vector size="${sheetTitles.length + ranges.length}" baseType="lpstr">${[...sheetTitles, ...ranges].join("")}</vt:vector></TitlesOfParts>`);
      if (srcArea) next = next.replace(namedCount, (m, k) => m.replace(`<vt:i4>${k}</vt:i4>`, `<vt:i4>${Number(k) + copies.length}</vt:i4>`));
      put("docProps/app.xml", next);
    }
  }
}

/** Exposed for the test that checks the evaluator against Excel's own cache. */
export const __test = { SheetXml, Evaluator, shiftFormula, sheetPaths, sharedStrings };
