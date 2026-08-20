/**
 * Render an uploaded .xlsx/.xls workbook to a self-contained HTML page so it can
 * be previewed in the browser without downloading (browsers can't display xlsx
 * natively). Each worksheet becomes a table; merged cells map to colspan/rowspan.
 * This is a read-only visual preview — formulas show their cached result.
 */
import ExcelJS from "exceljs";

const MAX_ROWS = 300; // guard against runaway sheets
const MAX_COLS = 40;

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Format a JS Date as a plain "Month D, YYYY" (UTC, to match the stored serial). */
function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "long", day: "numeric" }).format(d);
}

/** An Excel date serial (days since 1899-12-30) → JS Date at UTC midnight. */
function serialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
}

/** Whether a number format renders a date (has y/m/d tokens and no numeric # / 0). */
function looksLikeDateFmt(fmt: string | undefined): boolean {
  if (!fmt) return false;
  const f = fmt.replace(/\[[^\]]*\]/g, "").replace(/"[^"]*"/g, "");
  return /[ymd]/i.test(f) && !/[#0]/.test(f);
}

// A formula that is nothing but a single (optionally sheet-qualified, optionally
// absolute) cell reference, e.g. "Source!B69", "'Centrifugal Blower'!$A$1", "B12".
const SINGLE_REF_RE = /^'?([^'!]+?)'?!?\$?([A-Z]+)\$?(\d+)$/;

/** Best-effort readable text for a plain (non-formula) cell value. */
function cellText(value: ExcelJS.CellValue, numFmt?: string): string {
  if (value == null) return "";
  if (value instanceof Date) return fmtDate(value);
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join("");
    if (typeof v.text === "string") return v.text; // hyperlink label
    return "";
  }
  if (typeof value === "number") {
    if (looksLikeDateFmt(numFmt)) return fmtDate(serialToDate(value));
    return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  return String(value);
}

/**
 * Display text for a cell, resolving formulas. The Fans & Blowers job order is a
 * template of pure formulas over a hidden "Source" sheet; ExcelJS can't evaluate
 * formulas, so a plain read shows the template's STALE cached sample values. For
 * a formula that is a single cell reference (the header: JO#, dates, project, …)
 * we follow it to the live value we wrote into Source. VLOOKUP / arithmetic
 * formulas can't be resolved, so those fall back to the cached result.
 */
function resolveCellText(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, cell: ExcelJS.Cell, depth = 0): string {
  const value = cell.value;
  const numFmt = (cell as unknown as { numFmt?: string }).numFmt;
  if (value && typeof value === "object" && "formula" in (value as object)) {
    const v = value as unknown as { formula?: string; result?: unknown };
    const ref = typeof v.formula === "string" ? SINGLE_REF_RE.exec(v.formula.replace(/\s+/g, "")) : null;
    if (ref && depth < 6) {
      const target = ref[1] && ref[1] !== ws.name ? wb.getWorksheet(ref[1]) : ws;
      if (target) return resolveCellText(wb, target, target.getCell(`${ref[2]}${ref[3]}`), depth + 1);
    }
    const res = v.result;
    if (res == null) return "";
    if (res instanceof Date) return fmtDate(res);
    if (typeof res === "object") return ""; // formula error (e.g. #N/A)
    if (typeof res === "number" && looksLikeDateFmt(numFmt)) return fmtDate(serialToDate(res));
    return typeof res === "number" ? res.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(res);
  }
  return cellText(value, numFmt);
}

/** Parse "B12" → { col, row } (1-based). */
function parseAddr(addr: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!m) return { col: 1, row: 1 };
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/** Embedded images on a sheet (e.g. the form's logo/header), as data URIs. */
function sheetImages(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet): string[] {
  const wsAny = ws as unknown as { getImages?: () => { imageId: number | string }[] };
  const list = typeof wsAny.getImages === "function" ? wsAny.getImages() : [];
  const media = ((wb.model as unknown as { media?: { buffer?: Buffer; extension?: string }[] }).media) ?? [];
  const wbAny = wb as unknown as { getImage?: (id: number) => { buffer?: Buffer; extension?: string } };
  const out: string[] = [];
  for (const im of list) {
    const id = Number(im.imageId);
    let m: { buffer?: Buffer; extension?: string } | undefined;
    try { m = typeof wbAny.getImage === "function" ? wbAny.getImage(id) : media[id]; } catch { m = media[id]; }
    if (m?.buffer) {
      const ext = (m.extension || "png").replace("jpeg", "jpg");
      const mime = ext === "jpg" ? "jpeg" : ext === "svg" ? "svg+xml" : ext;
      out.push(`data:image/${mime};base64,${Buffer.from(m.buffer).toString("base64")}`);
    }
  }
  return out;
}

function renderSheet(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet): string {
  const rowCount = Math.min(ws.actualRowCount || ws.rowCount || 0, MAX_ROWS);
  const colCount = Math.min(ws.actualColumnCount || ws.columnCount || 0, MAX_COLS);
  if (rowCount === 0 || colCount === 0) return `<p class="empty">(empty sheet)</p>`;

  // Merge map: slave "col,row" → skip; master "col,row" → { colspan, rowspan }.
  const skip = new Set<string>();
  const span = new Map<string, { colspan: number; rowspan: number }>();
  const merges = (ws.model as unknown as { merges?: string[] }).merges ?? [];
  for (const range of merges) {
    const [a, b] = range.split(":");
    if (!a || !b) continue;
    const tl = parseAddr(a), br = parseAddr(b);
    span.set(`${tl.col},${tl.row}`, { colspan: br.col - tl.col + 1, rowspan: br.row - tl.row + 1 });
    for (let r = tl.row; r <= br.row; r++) {
      for (let c = tl.col; c <= br.col; c++) {
        if (!(c === tl.col && r === tl.row)) skip.add(`${c},${r}`);
      }
    }
  }

  // Trim outer whitespace: the printable templates carry many empty header/spacer
  // rows (where the logo image sits) and trailing empty columns. Drop the leading
  // & trailing all-empty rows and the trailing all-empty columns so the preview
  // shows the form, not a sea of blank cells. A merged master carrying text keeps
  // its row/column non-empty (it has text at the master cell), so merges survive.
  const rowText: string[][] = [];
  for (let r = 1; r <= rowCount; r++) {
    const row: string[] = [];
    for (let c = 1; c <= colCount; c++) row[c] = resolveCellText(wb, ws, ws.getCell(r, c));
    rowText[r] = row;
  }
  const rowEmpty = (r: number) => rowText[r].every((t) => (t ?? "").trim() === "");
  const colEmpty = (c: number) => { for (let r = 1; r <= rowCount; r++) if ((rowText[r][c] ?? "").trim() !== "") return false; return true; };
  let firstRow = 1; while (firstRow < rowCount && rowEmpty(firstRow)) firstRow++;
  let lastRow = rowCount; while (lastRow > firstRow && rowEmpty(lastRow)) lastRow--;
  let lastCol = colCount; while (lastCol > 1 && colEmpty(lastCol)) lastCol--;

  const trs: string[] = [];
  for (let r = firstRow; r <= lastRow; r++) {
    const tds: string[] = [];
    for (let c = 1; c <= lastCol; c++) {
      const key = `${c},${r}`;
      if (skip.has(key)) continue;
      const cell = ws.getCell(r, c);
      const text = rowText[r][c] ?? "";
      const align = cell.alignment?.horizontal;
      const bold = cell.font?.bold ? " b" : "";
      // Cells set to wrap in the workbook (e.g. Note / Remarks) must wrap in the
      // preview too — otherwise a long note runs off to the right on one line.
      const wrap = cell.alignment?.wrapText ? " wrap" : "";
      const sp = span.get(key);
      const colspan = sp ? Math.min(sp.colspan, lastCol - c + 1) : 1;
      const rowspan = sp ? Math.min(sp.rowspan, lastRow - r + 1) : 1;
      const cls = `${align ? `a-${esc(align)}` : ""}${bold}${wrap}`.trim();
      const attrs = [
        colspan > 1 ? `colspan="${colspan}"` : "",
        rowspan > 1 ? `rowspan="${rowspan}"` : "",
        cls ? `class="${cls}"` : "",
      ].filter(Boolean).join(" ");
      tds.push(`<td ${attrs}>${esc(text)}</td>`);
    }
    trs.push(`<tr>${tds.join("")}</tr>`);
  }
  // The template's logo/header images (which the cell grid can't show) go on top.
  const imgs = sheetImages(wb, ws);
  const banner = imgs.length ? `<div class="imgs">${imgs.map((u) => `<img src="${esc(u)}" alt="" />`).join("")}</div>` : "";
  return `${banner}<table>${trs.join("")}</table>`;
}

export function renderXlsxAsHtml(wb: ExcelJS.Workbook, title: string): string {
  // Skip hidden sheets — e.g. the job order's "Source" lookup sheet, which drives
  // the printable sheet's formulas but is never meant to be seen. Fall back to all
  // sheets if every sheet happens to be hidden.
  const visible = wb.worksheets.filter((ws) => ws.state !== "hidden" && ws.state !== "veryHidden");
  const shown = visible.length ? visible : wb.worksheets;
  const sheets = shown
    .map((ws) => `<section><h2>${esc(ws.name)}</h2>${renderSheet(wb, ws)}</section>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #f3f4f6; color: #111827; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  .bar { position: sticky; top: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; background: #111827; color: #fff; padding: 8px 16px; }
  .bar .name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar a { background: #ED1C24; color: #fff; text-decoration: none; border-radius: 6px; padding: 6px 12px; font-size: 13px; font-weight: 600; white-space: nowrap; }
  .bar .actions { display: flex; gap: 8px; }
  .bar button, .bar a { background: #ED1C24; color: #fff; text-decoration: none; border: 0; cursor: pointer; border-radius: 6px; padding: 6px 12px; font-size: 13px; font-weight: 600; white-space: nowrap; }
  .bar a.ghost { background: #374151; }
  .wrap { max-width: 1100px; margin: 14px auto; padding: 0 12px; }
  section { background: #fff; margin: 0 0 16px; padding: 14px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.12); overflow-x: auto; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; margin: 0 0 10px; }
  .imgs { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0 0 12px; }
  .imgs img { max-height: 90px; max-width: 100%; object-fit: contain; }
  table { border-collapse: collapse; font-size: 13px; }
  td { border: 1px solid #d1d5db; padding: 4px 8px; vertical-align: middle; white-space: nowrap; }
  td.wrap { white-space: pre-wrap; word-break: break-word; vertical-align: top; }
  td.b, td.a-center.b, td.a-right.b, td.a-left.b { font-weight: 700; }
  td.a-center { text-align: center; }
  td.a-right { text-align: right; }
  td.a-left { text-align: left; }
  .empty { color: #9ca3af; font-style: italic; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .wrap { max-width: none; margin: 0; padding: 0; }
    section { box-shadow: none; border-radius: 0; margin: 0; padding: 0; break-inside: avoid; }
    h2 { display: none; }
  }
  @page { margin: 12mm; }
</style>
</head><body>
  <div class="bar">
    <span class="name">${esc(title)}</span>
    <div class="actions">
      <button type="button" onclick="window.print()" title="Print or save as PDF">Print / Save as PDF</button>
      <a class="ghost" href="?download=1" title="Download the original .xlsx">Download</a>
    </div>
  </div>
  <div class="wrap">${sheets || "<section><p class='empty'>(no sheets)</p></section>"}</div>
</body></html>`;
}
