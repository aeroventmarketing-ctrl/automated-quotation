/**
 * Generates the AFBM "Standard – Fans & Blowers" quotation as an .xlsx,
 * reproducing the reference template: exact column widths, Times New Roman,
 * embedded AEROVENT logo, grouped table headers (Capacity / Static Pressure /
 * Size / MOTOR), centered cells, red dynamic values, and VAT-inclusive or
 * VAT-exclusive totals with an optional discount line.
 *
 * Output is an exact Excel file (download); users can Save-as-PDF from Excel.
 */
import ExcelJS from "exceljs";
import { COMPANY } from "@/lib/config";
import { HEADER_LOGO, HEADER_LOGO_RATIO } from "./header-logo";

export interface XlsxLine {
  itemLabel: string;
  descriptionSnapshot: string;
  qty: number;
  unitPrice: number; // VAT-inclusive (as stored)
  lineTotal: number; // VAT-inclusive
  capacity_cfm?: number | null;
  staticPressure_inwg?: number | null;
  inches?: number | null;
  motorHp?: number | string | null;
  motorPh?: number | null;
  motorVolts?: number | null;
}

export interface XlsxData {
  quoteNumber: string;
  dateStr: string;
  projectName?: string | null;
  customerName: string;
  vatMode: "INCLUSIVE" | "EXCLUSIVE" | "EXCLUSIVE_PLUS";
  discountPct: number; // e.g. 3 for 3%
  vatRate: number;
  // Variable (red) unit labels for the table header.
  capacityUnit?: string; // default "cfm"
  pressureUnit?: string; // default "in-w.g."
  motorUnit?: string; // default "HP"
  preparedBy: string;
  preparedByTitle?: string; // default "Marketing Representative"
  specNote?: string | null;
  terms?: string | null;
  items: XlsxLine[];
  total: number; // VAT-inclusive gross sum of stored line totals
}

const FONT = "Times New Roman";
// Output text is all black. (In the source template, red marked client-editable
// fields; in the app those are edited in the quotation maker, so the generated
// file uses black throughout — only the logo/header image carries colour.)
const RED = { argb: "FF000000" };
const BLACK = { argb: "FF000000" };
const thin = { style: "thin" as const, color: BLACK };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

const money = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

export async function buildQuotationXlsx(data: XlsxData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Quotation", {
    // Open the sheet in Page Break Preview so the printable layout shows on
    // open, with gridlines visible.
    views: [{ showGridLines: true, style: "pageBreakPreview" }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.1, bottom: 0.3, header: 0, footer: 0.2 },
    },
  });

  // Column A is a width-8 left gutter; the table content lives in B..P.
  const widths = [8, 6.63, 8.43, 2.63, 1.91, 5.63, 6.91, 7.91, 8.0, 7.09, 5.54, 4.45, 3.63, 4.63, 9.63, 16.36];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // --- Logo + letterhead -----------------------------------------------------
  // The letterhead image is pre-padded so the visible logo is 90% width and
  // centred; placing it edge-to-edge (full content width) keeps it centred
  // reliably across screen and print, with no fragile offset math.
  const colPx = widths.map((w) => Math.round(w * 7 + 5));
  // Full content width (B..P). The letterhead is sized to ~85% of it and kept
  // aspect-locked (height = width / ratio), then centred with equal side margins.
  const contentW = colPx.slice(1).reduce((a, b) => a + b, 0);
  const logoW = Math.round(contentW * 0.85);
  const logoH = Math.round(logoW / HEADER_LOGO_RATIO);
  const logoRows = Math.round(logoH / 19);
  // Left inset (px from column B's left edge) that centres the logo across B..P,
  // expressed as a fractional ExcelJS column index for the anchor.
  const leftInsetPx = Math.round((contentW - logoW) / 2);
  const logoStartCol = (() => {
    let acc = 0;
    for (let c = 1; c < colPx.length; c++) {
      if (acc + colPx[c] >= leftInsetPx) return c + (leftInsetPx - acc) / colPx[c];
      acc += colPx[c];
    }
    return colPx.length;
  })();
  for (let rr = 1; rr <= logoRows; rr++) ws.getRow(rr).height = 19;
  const imgId = wb.addImage({ base64: HEADER_LOGO.split(",")[1], extension: "png" });
  // Aspect-locked, centred across B..P, and moves with the header cell.
  ws.addImage(imgId, {
    tl: { col: logoStartCol, row: 0 },
    ext: { width: logoW, height: logoH },
    editAs: "oneCell",
  });

  const center = (v: ExcelJS.CellValue, size: number, bold = false, italic = false) => ({
    value: v,
    font: { name: FONT, size, bold, italic, color: BLACK },
    alignment: { horizontal: "center" as const, vertical: "middle" as const },
  });
  // The header image already contains the logo + all company text, so no
  // separate text rows are needed — meta starts just below the letterhead.
  let row = logoRows;

  // --- Meta -----------------------------------------------------------------
  ws.getCell(`B${row}`).value = `QUOT NO. ${data.quoteNumber}`;
  ws.getCell(`B${row}`).font = { name: FONT, size: 11, bold: false, color: BLACK };
  ws.mergeCells(`O${row}:P${row}`);
  Object.assign(ws.getCell(`O${row}`), {
    value: data.dateStr,
    font: { name: FONT, size: 11, color: RED },
    alignment: { horizontal: "right" as const },
  });
  row += 3; // extra row after QUOT NO
  if (data.projectName) {
    ws.getCell(`B${row}`).value = "PROJECT : ";
    ws.getCell(`B${row}`).font = { name: FONT, size: 11, bold: false, color: BLACK };
    ws.getCell(`D${row}`).value = data.projectName;
    ws.getCell(`D${row}`).font = { name: FONT, size: 11, color: RED };
    row += 3; // two blank rows after PROJECT
  }
  ws.getCell(`B${row}`).value = "TO : ";
  ws.getCell(`B${row}`).font = { name: FONT, size: 11, bold: false, color: BLACK };
  ws.getCell(`D${row}`).value = data.customerName;
  ws.getCell(`D${row}`).font = { name: FONT, size: 11, color: RED };
  row += 3; // extra row after TO
  ws.getCell(`B${row}`).value = "Dear Sir/Ma'am:";
  ws.getCell(`B${row}`).font = { name: FONT, size: 11, color: BLACK };
  row++;
  ws.getRow(row).height = 8; // thin 8px spacer after the salutation
  row++;
  ws.getCell(`C${row}`).value = "We are pleased to quote the price for your ventilation requirements.";
  ws.getCell(`C${row}`).font = { name: FONT, size: 11, color: BLACK };
  row += 2;

  // --- Table header (3 rows) ------------------------------------------------
  const H1 = row, HM = row + 1, H3 = row + 2;
  ws.mergeCells(`B${H1}:B${H3}`);
  ws.mergeCells(`C${H1}:C${H3}`);
  ws.mergeCells(`D${H1}:H${H3}`);
  ws.mergeCells(`I${H1}:I${HM}`);
  ws.mergeCells(`J${H1}:J${HM}`);
  ws.mergeCells(`K${H1}:K${HM}`);
  ws.mergeCells(`L${H1}:N${HM}`); // MOTOR
  ws.mergeCells(`O${H1}:O${H3}`);
  ws.mergeCells(`P${H1}:P${H3}`);
  const hset = (addr: string, text: string, size = 9) => {
    Object.assign(ws.getCell(addr), center(text, size, false));
    ws.getCell(addr).border = allBorders;
  };
  hset(`B${H1}`, "Item", 10);
  hset(`C${H1}`, "Qty", 10);
  hset(`D${H1}`, "Description", 10);
  hset(`I${H1}`, "Capacity");
  hset(`J${H1}`, "Static Pressure");
  hset(`K${H1}`, "Size");
  // Wrap the grouped headers so long labels fit their narrow columns.
  ["I", "J", "K"].forEach((c) => {
    ws.getCell(`${c}${H1}`).alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
  });
  hset(`L${H1}`, "MOTOR", 10);
  hset(`O${H1}`, "Unit Price", 9);
  hset(`P${H1}`, "Total Price", 9);
  // sub-units row 25. Variable units (capacity / pressure / motor) are RED and
  // editable per client; Inches / Ph / Volts are fixed black.
  const hsetRed = (addr: string, text: string) => {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { name: FONT, size: 9, bold: true, color: RED };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = allBorders;
  };
  hsetRed(`I${H3}`, data.capacityUnit || "cfm");
  hsetRed(`J${H3}`, data.pressureUnit || "in-w.g.");
  hset(`K${H3}`, "Inches");
  hsetRed(`L${H3}`, data.motorUnit || "HP");
  hset(`M${H3}`, "Ph");
  hset(`N${H3}`, "Volts");
  [ws.getRow(H1), ws.getRow(HM), ws.getRow(H3)].forEach((r) => (r.height = 13));
  // border the motor sub-cells on row 25
  ["L", "M", "N"].forEach((c) => (ws.getCell(`${c}${H3}`).border = allBorders));

  // --- Data rows ------------------------------------------------------------
  const f = data.vatMode !== "INCLUSIVE" ? 1 / (1 + data.vatRate) : 1;
  let r = H3 + 1;
  const dash = (v: number | string | null | undefined) =>
    v === null || v === undefined || v === 0 || v === "" ? "--" : v;

  for (const it of data.items) {
    ws.mergeCells(`D${r}:H${r}`);
    const cellCfg = (addr: string, v: ExcelJS.CellValue, size: number, wrap = false) => {
      const c = ws.getCell(addr);
      c.value = v;
      c.font = { name: FONT, size, color: RED };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: wrap };
      c.border = allBorders;
    };
    cellCfg(`B${r}`, it.itemLabel, 9);
    cellCfg(`C${r}`, it.qty, 11);
    cellCfg(`D${r}`, it.descriptionSnapshot, 10, true);
    // ensure merged-away cells D..G carry borders
    ["E", "F", "G", "H"].forEach((c) => (ws.getCell(`${c}${r}`).border = allBorders));
    cellCfg(`I${r}`, dash(it.capacity_cfm), 9);
    cellCfg(`J${r}`, dash(it.staticPressure_inwg), 9);
    cellCfg(`K${r}`, dash(it.inches), 9);
    cellCfg(`L${r}`, dash(it.motorHp ?? null), 9);
    cellCfg(`M${r}`, dash(it.motorPh), 9);
    cellCfg(`N${r}`, dash(it.motorVolts), 9);
    cellCfg(`O${r}`, money(it.unitPrice * f), 9);
    ws.getCell(`O${r}`).numFmt = "#,##0.00";
    cellCfg(`P${r}`, money(it.lineTotal * f), 9);
    ws.getCell(`P${r}`).numFmt = "#,##0.00";

    // Auto-fit row height to the (wrapped) description. Excel does NOT
    // auto-grow merged cells, so estimate wrapped line count from the merged
    // C:G width (~25 chars at Times New Roman 10).
    const descCharsPerLine = 25;
    const wrappedLines = String(it.descriptionSnapshot)
      .split("\n")
      .reduce((acc, seg) => acc + Math.max(1, Math.ceil(seg.length / descCharsPerLine)), 0);
    ws.getRow(r).height = Math.max(28, wrappedLines * 13.5);
    r++;
  }

  // --- Totals ---------------------------------------------------------------
  const displayedNet = money(data.total * f);
  const discountAmt = money(displayedNet * (data.discountPct / 100));
  const finalNet = money(displayedNet - discountAmt);
  const netLabel =
    data.vatMode !== "INCLUSIVE"
      ? "NET AMOUNT (VAT exclusive price) =>"
      : "NET AMOUNT (VAT inclusive price) =>";

  function totalRow(label: string, value: number, valColor: "RED" | "BLACK" = "RED") {
    ws.mergeCells(`B${r}:O${r}`);
    const lc = ws.getCell(`B${r}`);
    lc.value = label;
    lc.font = { name: FONT, size: 11, bold: true, color: BLACK };
    lc.alignment = { horizontal: "right", vertical: "middle" };
    lc.border = allBorders;
    ["C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O"].forEach(
      (c) => (ws.getCell(`${c}${r}`).border = allBorders),
    );
    const vc = ws.getCell(`P${r}`);
    vc.value = value;
    vc.numFmt = "#,##0.00";
    vc.font = { name: FONT, size: 11, bold: true, color: BLACK };
    vc.alignment = { horizontal: "right", vertical: "middle" };
    vc.border = allBorders;
    ws.getRow(r).height = 16;
    r++;
  }
  totalRow(netLabel, displayedNet, "RED");
  if (data.discountPct > 0) {
    totalRow(`LESS ${data.discountPct}% DISCOUNT`, discountAmt, "BLACK");
    totalRow("NET AMOUNT", finalNet, "BLACK");
  }
  if (data.vatMode === "EXCLUSIVE_PLUS") {
    const vat = money(finalNet * data.vatRate);
    totalRow(`ADD ${Math.round(data.vatRate * 100)}% VAT`, vat, "BLACK");
    totalRow("TOTAL AMOUNT", money(finalNet + vat), "BLACK");
  }

  // --- Note -----------------------------------------------------------------
  if (data.specNote) {
    ws.mergeCells(`B${r}:P${r + 1}`);
    const c = ws.getCell(`B${r}`);
    c.value = `Note: ${data.specNote}`;
    c.font = { name: FONT, size: 9, color: BLACK };
    c.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    r += 2;
  }

  // --- Page break + repeated letterhead on page 2 ---------------------------
  ws.getRow(r).addPageBreak();
  r += 1;
  // Repeat the same header logo at the top of page 2 — same centred, aspect-
  // locked placement as page 1.
  ws.addImage(imgId, {
    tl: { col: logoStartCol, row: r - 1 },
    ext: { width: logoW, height: logoH },
    editAs: "oneCell",
  });
  for (let i = 0; i < logoRows; i++) ws.getRow(r + i).height = 19;
  r += logoRows - 1; // tighten gap below the page-2 logo (match page 1)

  // --- Terms (structured: "Label  :  text" columns) -------------------------
  ws.getCell(`B${r}`).value = "The above quotation is subject to the following terms and conditions:";
  ws.getCell(`B${r}`).font = { name: FONT, size: 10, bold: false, color: BLACK };
  r += 2;

  const TERMS_CPL = 75; // approx chars per line that fit the merged G:P text area (Times New Roman 10)
  if (data.terms) {
    const lines = data.terms.split("\n").map((l) => l.replace(/\r/g, "").trim());
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (line === "") {
        r += 1;
        i++;
        continue;
      }
      const m = line.match(/^(\d+\.\s*[^:]+?)\s*:\s*(.*)$/);
      let body = line;
      let label: string | null = null;
      if (m) {
        label = m[1].trim();
        body = m[2].trim();
        // If a numbered term has no inline text (e.g. "5. Warranty :"), bring
        // its first sub-item up onto the same row.
        if (body === "" && i + 1 < lines.length && lines[i + 1] !== "") {
          i++;
          body = lines[i];
        }
      }
      if (label !== null) {
        const lc = ws.getCell(`B${r}`);
        lc.value = label;
        lc.font = { name: FONT, size: 10, color: BLACK };
        lc.alignment = { vertical: "middle" };
        const cc = ws.getCell(`E${r}`);
        cc.value = ":";
        cc.font = { name: FONT, size: 10, color: BLACK };
        cc.alignment = { vertical: "middle" };
      }
      ws.mergeCells(`G${r}:P${r}`);
      const tc = ws.getCell(`G${r}`);
      tc.value = body;
      tc.font = { name: FONT, size: 10, color: BLACK };
      tc.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      const wlines = Math.max(1, Math.ceil(body.length / TERMS_CPL));
      // These clauses wrap to 3 lines in Excel; give them room so no text hides.
      const threeLine = label === "11. Cancellation" || label === "1. Payment";
      ws.getRow(r).height = threeLine ? 48 : wlines * 16;
      r++;
      i++;
    }
  }

  // --- Closing + signature --------------------------------------------------
  r += 1;
  ws.mergeCells(`B${r}:P${r}`); // closing on a single (unmerged) row, wrapped
  const cl = ws.getCell(`B${r}`);
  cl.value = COMPANY.closing;
  cl.font = { name: FONT, size: 10, color: BLACK };
  cl.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  ws.getRow(r).height = 14.5;
  r += 2;
  ws.getCell(`B${r}`).value = "Very Truly Yours,";
  ws.getCell(`B${r}`).font = { name: FONT, size: 10, color: BLACK };
  r += 4; // extra signature space before the name
  // Signature lines centred across B:E (name varies by sales representative).
  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = data.preparedBy;
  ws.getCell(`B${r}`).font = { name: FONT, size: 10, bold: true, color: BLACK };
  ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 16;
  r += 1;
  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = data.preparedByTitle || "Marketing Representative";
  ws.getCell(`B${r}`).font = { name: FONT, size: 10, color: BLACK };
  ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 16;
  r += 1;
  ws.mergeCells(`B${r}:E${r}`);
  ws.getCell(`B${r}`).value = COMPANY.signatory;
  ws.getCell(`B${r}`).font = { name: FONT, size: 10, color: BLACK };
  ws.getCell(`B${r}`).alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(r).height = 16;

  // Print/page-break area is the content block only — B..P — so the empty left
  // gutter (column A) and anything past column P are excluded from the page.
  ws.pageSetup.printArea = `B1:P${r}`;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
