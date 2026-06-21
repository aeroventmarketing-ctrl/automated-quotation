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
  vatMode: "INCLUSIVE" | "EXCLUSIVE";
  discountPct: number; // e.g. 3 for 3%
  vatRate: number;
  // Variable (red) unit labels for the table header.
  capacityUnit?: string; // default "cfm"
  pressureUnit?: string; // default "in-w.g."
  motorUnit?: string; // default "Hp"
  preparedBy: string;
  specNote?: string | null;
  terms?: string | null;
  items: XlsxLine[];
  total: number; // VAT-inclusive gross sum of stored line totals
}

const FONT = "Times New Roman";
const RED = { argb: "FFFF0000" };
const BLACK = { argb: "FF000000" };
const thin = { style: "thin" as const, color: BLACK };
const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

const money = (n: number) =>
  Math.round((n + Number.EPSILON) * 100) / 100;

export async function buildQuotationXlsx(data: XlsxData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Quotation", {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, // A4
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.1, bottom: 0.3, header: 0, footer: 0.2 },
    },
  });

  // Exact column widths from the reference file (A..O).
  const widths = [6.63, 8.43, 2.63, 1.91, 5.63, 6.91, 7.91, 8.0, 7.09, 5.54, 4.45, 3.63, 4.63, 9.63, 16.36];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // --- Logo + letterhead -----------------------------------------------------
  // Header logo spans the full content width at the very top (horizontally
  // centred by filling edge-to-edge). Content width ≈ sum of column widths.
  const totalCharW = widths.reduce((a, w) => a + w, 0);
  const contentPx = Math.round(totalCharW * 7 + 12);
  const logoW = contentPx;
  const logoH = Math.round(logoW / HEADER_LOGO_RATIO);
  const imgId = wb.addImage({ base64: HEADER_LOGO.split(",")[1], extension: "jpeg" });
  ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: logoW, height: logoH } });
  // Reserve rows for the logo height (≈19px per default row).
  const logoRows = Math.ceil(logoH / 19);
  for (let r = 1; r <= logoRows; r++) ws.getRow(r).height = 19;

  const center = (v: ExcelJS.CellValue, size: number, bold = false, italic = false) => ({
    value: v,
    font: { name: FONT, size, bold, italic, color: BLACK },
    alignment: { horizontal: "center" as const, vertical: "middle" as const },
  });
  let row = logoRows + 1;
  function head(text: string, size: number, bold = false) {
    ws.mergeCells(`A${row}:O${row}`);
    Object.assign(ws.getCell(`A${row}`), center(text, size, bold));
    row++;
  }
  head("FANS & BLOWERS MANUFACTURING", 12, true);
  head(COMPANY.tagline, 8, true);
  head(COMPANY.landline, 7.5);
  head(COMPANY.mobile, 7.5);
  head(COMPANY.plantAddress, 7.5);
  head(`Email: ${COMPANY.email}   /   Website: ${COMPANY.website}`, 7.5);
  row++; // spacer

  // --- Meta -----------------------------------------------------------------
  ws.getCell(`A${row}`).value = `QUOT NO. ${data.quoteNumber}`;
  ws.getCell(`A${row}`).font = { name: FONT, size: 11, bold: true, color: BLACK };
  ws.mergeCells(`N${row}:O${row}`);
  Object.assign(ws.getCell(`N${row}`), {
    value: data.dateStr,
    font: { name: FONT, size: 11, color: RED },
    alignment: { horizontal: "right" as const },
  });
  row += 2;
  if (data.projectName) {
    ws.getCell(`A${row}`).value = "PROJECT : ";
    ws.getCell(`A${row}`).font = { name: FONT, size: 11, bold: true, color: BLACK };
    ws.getCell(`C${row}`).value = data.projectName;
    ws.getCell(`C${row}`).font = { name: FONT, size: 11, color: RED };
    row++;
  }
  ws.getCell(`A${row}`).value = "TO : ";
  ws.getCell(`A${row}`).font = { name: FONT, size: 11, bold: true, color: BLACK };
  ws.getCell(`C${row}`).value = data.customerName;
  ws.getCell(`C${row}`).font = { name: FONT, size: 11, color: RED };
  row += 2;
  ws.getCell(`A${row}`).value = "Dear Sir/Ma'am:";
  ws.getCell(`A${row}`).font = { name: FONT, size: 11, color: BLACK };
  row++;
  ws.getCell(`A${row}`).value = "We are pleased to quote the price for your ventilation requirements.";
  ws.getCell(`A${row}`).font = { name: FONT, size: 11, color: BLACK };
  row += 2;

  // --- Table header (3 rows) ------------------------------------------------
  const H1 = row, HM = row + 1, H3 = row + 2;
  ws.mergeCells(`A${H1}:A${H3}`);
  ws.mergeCells(`B${H1}:B${H3}`);
  ws.mergeCells(`C${H1}:G${H3}`);
  ws.mergeCells(`H${H1}:H${HM}`);
  ws.mergeCells(`I${H1}:I${HM}`);
  ws.mergeCells(`J${H1}:J${HM}`);
  ws.mergeCells(`K${H1}:M${HM}`); // MOTOR
  ws.mergeCells(`N${H1}:N${H3}`);
  ws.mergeCells(`O${H1}:O${H3}`);
  const hset = (addr: string, text: string, size = 9) => {
    Object.assign(ws.getCell(addr), center(text, size, false));
    ws.getCell(addr).border = allBorders;
  };
  hset(`A${H1}`, "Item", 10);
  hset(`B${H1}`, "Qty", 10);
  hset(`C${H1}`, "Description", 10);
  hset(`H${H1}`, "Capacity");
  hset(`I${H1}`, "Static Pressure");
  hset(`J${H1}`, "Size");
  hset(`K${H1}`, "MOTOR", 10);
  hset(`N${H1}`, "Unit Price", 9);
  hset(`O${H1}`, "Total Price", 9);
  // sub-units row 25. Variable units (capacity / pressure / motor) are RED and
  // editable per client; Inches / Ph / Volts are fixed black.
  const hsetRed = (addr: string, text: string) => {
    const c = ws.getCell(addr);
    c.value = text;
    c.font = { name: FONT, size: 9, bold: true, color: RED };
    c.alignment = { horizontal: "center", vertical: "middle" };
    c.border = allBorders;
  };
  hsetRed(`H${H3}`, data.capacityUnit || "cfm");
  hsetRed(`I${H3}`, data.pressureUnit || "in-w.g.");
  hset(`J${H3}`, "Inches");
  hsetRed(`K${H3}`, data.motorUnit || "Hp");
  hset(`L${H3}`, "Ph");
  hset(`M${H3}`, "Volts");
  [ws.getRow(H1), ws.getRow(HM), ws.getRow(H3)].forEach((r) => (r.height = 13));
  // border the motor sub-cells on row 25
  ["K", "L", "M"].forEach((c) => (ws.getCell(`${c}${H3}`).border = allBorders));

  // --- Data rows ------------------------------------------------------------
  const f = data.vatMode === "EXCLUSIVE" ? 1 / (1 + data.vatRate) : 1;
  let r = H3 + 1;
  const dash = (v: number | string | null | undefined) =>
    v === null || v === undefined || v === 0 || v === "" ? "--" : v;

  for (const it of data.items) {
    ws.mergeCells(`C${r}:G${r}`);
    const cellCfg = (addr: string, v: ExcelJS.CellValue, size: number, wrap = false) => {
      const c = ws.getCell(addr);
      c.value = v;
      c.font = { name: FONT, size, color: RED };
      c.alignment = { horizontal: "center", vertical: "middle", wrapText: wrap };
      c.border = allBorders;
    };
    cellCfg(`A${r}`, it.itemLabel, 9);
    cellCfg(`B${r}`, it.qty, 11);
    cellCfg(`C${r}`, it.descriptionSnapshot, 10, true);
    // ensure merged-away cells D..G carry borders
    ["D", "E", "F", "G"].forEach((c) => (ws.getCell(`${c}${r}`).border = allBorders));
    cellCfg(`H${r}`, dash(it.capacity_cfm), 9);
    cellCfg(`I${r}`, dash(it.staticPressure_inwg), 9);
    cellCfg(`J${r}`, dash(it.inches), 9);
    cellCfg(`K${r}`, dash(it.motorHp ?? null), 9);
    cellCfg(`L${r}`, dash(it.motorPh), 9);
    cellCfg(`M${r}`, dash(it.motorVolts), 9);
    cellCfg(`N${r}`, money(it.unitPrice * f), 9);
    ws.getCell(`N${r}`).numFmt = "#,##0.00";
    cellCfg(`O${r}`, money(it.lineTotal * f), 9);
    ws.getCell(`O${r}`).numFmt = "#,##0.00";

    // auto row height by description lines
    const lines = String(it.descriptionSnapshot).split("\n").length;
    ws.getRow(r).height = Math.max(28, lines * 12.5);
    r++;
  }

  // --- Totals ---------------------------------------------------------------
  const displayedNet = money(data.total * f);
  const discountAmt = money(displayedNet * (data.discountPct / 100));
  const finalNet = money(displayedNet - discountAmt);
  const netLabel =
    data.vatMode === "EXCLUSIVE"
      ? "NET AMOUNT (VAT exclusive price) =>"
      : "NET AMOUNT (VAT inclusive price) =>";

  function totalRow(label: string, value: number, valColor: "RED" | "BLACK" = "RED") {
    ws.mergeCells(`A${r}:N${r}`);
    const lc = ws.getCell(`A${r}`);
    lc.value = label;
    lc.font = { name: FONT, size: 11, bold: true, color: BLACK };
    lc.alignment = { horizontal: "right", vertical: "middle" };
    lc.border = allBorders;
    ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"].forEach(
      (c) => (ws.getCell(`${c}${r}`).border = allBorders),
    );
    const vc = ws.getCell(`O${r}`);
    vc.value = value;
    vc.numFmt = "#,##0.00";
    vc.font = { name: FONT, size: 11, bold: true, color: { argb: valColor === "RED" ? "FFFF0000" : "FF000000" } };
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

  // --- Note -----------------------------------------------------------------
  r += 1;
  if (data.specNote) {
    ws.mergeCells(`A${r}:O${r + 2}`);
    const c = ws.getCell(`A${r}`);
    c.value = `Note: ${data.specNote}`;
    c.font = { name: FONT, size: 9, color: BLACK };
    c.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    r += 3;
  }

  // --- Terms ----------------------------------------------------------------
  r += 1;
  ws.getCell(`A${r}`).value = "The above quotation is subject to the following terms and conditions:";
  ws.getCell(`A${r}`).font = { name: FONT, size: 9, bold: true, color: BLACK };
  r += 1;
  if (data.terms) {
    const termLines = data.terms.split("\n");
    const span = Math.max(termLines.length, 1);
    ws.mergeCells(`A${r}:O${r + span - 1}`);
    const c = ws.getCell(`A${r}`);
    c.value = data.terms;
    c.font = { name: FONT, size: 8.5, color: BLACK };
    c.alignment = { horizontal: "left", vertical: "top", wrapText: true };
    r += span;
  }

  // --- Signature ------------------------------------------------------------
  r += 2;
  ws.getCell(`A${r}`).value = COMPANY.closing;
  ws.getCell(`A${r}`).font = { name: FONT, size: 9, color: BLACK };
  ws.getCell(`A${r}`).alignment = { wrapText: true };
  r += 3;
  ws.getCell(`A${r}`).value = "Very Truly Yours,";
  ws.getCell(`A${r}`).font = { name: FONT, size: 10, color: BLACK };
  r += 3;
  ws.getCell(`A${r}`).value = data.preparedBy;
  ws.getCell(`A${r}`).font = { name: FONT, size: 10, bold: true, color: BLACK };
  r += 1;
  ws.getCell(`A${r}`).value = COMPANY.signatory;
  ws.getCell(`A${r}`).font = { name: FONT, size: 10, color: BLACK };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
