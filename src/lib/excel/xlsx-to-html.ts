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

/** Best-effort readable text for a cell value (rich text, hyperlink, formula, date). */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric" }).format(value);
  }
  if (typeof value === "object") {
    const v = value as unknown as Record<string, unknown>;
    if (Array.isArray(v.richText)) return (v.richText as { text: string }[]).map((t) => t.text).join("");
    if (typeof v.text === "string") return v.text; // hyperlink label
    if ("result" in v && v.result != null) return String(v.result); // formula → cached result
    if ("formula" in v) return "";
    return "";
  }
  if (typeof value === "number") return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return String(value);
}

/** Parse "B12" → { col, row } (1-based). */
function parseAddr(addr: string): { col: number; row: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!m) return { col: 1, row: 1 };
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

function renderSheet(ws: ExcelJS.Worksheet): string {
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

  const trs: string[] = [];
  for (let r = 1; r <= rowCount; r++) {
    const tds: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      const key = `${c},${r}`;
      if (skip.has(key)) continue;
      const cell = ws.getCell(r, c);
      const text = cellText(cell.value);
      const align = cell.alignment?.horizontal;
      const bold = cell.font?.bold ? " b" : "";
      const sp = span.get(key);
      const attrs = [
        sp && sp.colspan > 1 ? `colspan="${sp.colspan}"` : "",
        sp && sp.rowspan > 1 ? `rowspan="${sp.rowspan}"` : "",
        align ? `class="a-${esc(align)}${bold}"` : (bold ? `class="b"` : ""),
      ].filter(Boolean).join(" ");
      tds.push(`<td ${attrs}>${esc(text)}</td>`);
    }
    trs.push(`<tr>${tds.join("")}</tr>`);
  }
  return `<table>${trs.join("")}</table>`;
}

export function renderXlsxAsHtml(wb: ExcelJS.Workbook, title: string): string {
  const sheets = wb.worksheets
    .map((ws) => `<section><h2>${esc(ws.name)}</h2>${renderSheet(ws)}</section>`)
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
  .wrap { max-width: 1100px; margin: 14px auto; padding: 0 12px; }
  section { background: #fff; margin: 0 0 16px; padding: 14px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.12); overflow-x: auto; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .5px; color: #6b7280; margin: 0 0 10px; }
  table { border-collapse: collapse; font-size: 13px; }
  td { border: 1px solid #d1d5db; padding: 4px 8px; vertical-align: middle; white-space: nowrap; }
  td.b, td.a-center.b, td.a-right.b, td.a-left.b { font-weight: 700; }
  td.a-center { text-align: center; }
  td.a-right { text-align: right; }
  td.a-left { text-align: left; }
  .empty { color: #9ca3af; font-style: italic; }
</style>
</head><body>
  <div class="bar">
    <span class="name">${esc(title)}</span>
    <a href="?download=1" title="Download the original file">Download</a>
  </div>
  <div class="wrap">${sheets || "<section><p class='empty'>(no sheets)</p></section>"}</div>
</body></html>`;
}
