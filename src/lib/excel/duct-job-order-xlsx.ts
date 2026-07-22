/**
 * Builds a Duct Job Order workbook from scratch with ExcelJS.
 *
 * Unlike the Fans & Blowers job order (which fills a lookup-driven template), the
 * Duct JO is a straightforward list of segment lines, so we compose the printable
 * sheet directly: a branded header, the JO number + due date, then a table of
 * duct segments under the "(Horizontal x Vertical x Length)" column, followed by
 * the remarks/note.
 */
import ExcelJS from "exceljs";
import { COMPANY } from "@/lib/config";
import {
  formatSegmentDimensions,
  segmentTypeLabel,
  isReducingDuctType,
  type DuctJobOrder,
} from "@/lib/duct-job-order";

const RED = "FFED1C24";
const GREY = "FFF2F2F2";
const BORDER = "FFBFBFBF";

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" }).format(d);
}

export async function buildDuctJobOrderWorkbook(jo: DuctJobOrder): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY.name;
  const ws = wb.addWorksheet("Duct Job Order", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false, style: "pageBreakPreview", zoomScale: 120, zoomScaleNormal: 120 }],
  });

  // Column layout: # | Quantity | Unit | Dimensions | Duct type | Material | Gauge
  ws.columns = [
    { width: 5 },
    { width: 11 },
    { width: 8 },
    { width: 32 },
    { width: 16 },
    { width: 16 },
    { width: 10 },
  ];
  const LAST = "G";

  const thin = { style: "thin" as const, color: { argb: BORDER } };
  const allBorders = { top: thin, left: thin, bottom: thin, right: thin };

  // --- Header -------------------------------------------------------------
  ws.mergeCells(`A1:${LAST}1`);
  const title = ws.getCell("A1");
  title.value = COMPANY.name;
  title.font = { bold: true, size: 15, color: { argb: RED } };
  title.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 22;

  ws.mergeCells(`A2:${LAST}2`);
  const tagline = ws.getCell("A2");
  tagline.value = COMPANY.tagline;
  tagline.font = { size: 8, italic: true, color: { argb: "FF555555" } };
  tagline.alignment = { horizontal: "center" };

  ws.mergeCells(`A3:${LAST}3`);
  const doctype = ws.getCell("A3");
  doctype.value = "DUCT JOB ORDER";
  doctype.font = { bold: true, size: 13 };
  doctype.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(3).height = 20;

  // --- JO number / project / dates ---------------------------------------
  let r = 5;
  const infoRow = (label: string, value: string, label2?: string, value2?: string) => {
    const row = ws.getRow(r);
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = { bold: true, size: 10 };
    ws.mergeCells(`B${r}:D${r}`);
    ws.getCell(`B${r}`).value = value;
    ws.getCell(`B${r}`).font = { size: 10 };
    if (label2 != null) {
      ws.getCell(`E${r}`).value = label2;
      ws.getCell(`E${r}`).font = { bold: true, size: 10 };
      ws.getCell(`E${r}`).alignment = { horizontal: "right" };
      ws.mergeCells(`F${r}:G${r}`);
      ws.getCell(`F${r}`).value = value2 ?? "";
      ws.getCell(`F${r}`).font = { size: 10 };
    }
    row.height = 16;
    r++;
  };
  infoRow("JO No.:", jo.joNumber, "Date:", fmtDate(jo.date));
  infoRow("Project:", jo.project, "Due date:", fmtDate(jo.dueDate));

  // Make the JO number stand out.
  ws.getCell("B5").font = { bold: true, size: 11, color: { argb: RED } };
  // Make the due date stand out.
  ws.getCell("F6").font = { bold: true, size: 10, color: { argb: RED } };

  r++; // spacer

  // --- Segments table -----------------------------------------------------
  const headerRow = r;
  // # | Quantity | Unit | Dimensions | Duct type | Material | Gauge
  const DIM_COL = 3; // 0-based index of the dimensions column (left-aligned)
  const headers = ["#", "Quantity", "Unit", "(Horizontal x Vertical x Length)", "Duct type", "Material", "Gauge"];
  headers.forEach((h, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    cell.alignment = { horizontal: i === DIM_COL ? "left" : "center", vertical: "middle", wrapText: true };
    cell.border = allBorders;
  });
  ws.getRow(headerRow).height = 22;
  r++;

  if (jo.segments.length === 0) {
    const cell = ws.getCell(r, 1);
    ws.mergeCells(`A${r}:${LAST}${r}`);
    cell.value = "No duct segments listed.";
    cell.font = { italic: true, size: 10, color: { argb: "FF888888" } };
    cell.alignment = { horizontal: "center" };
    cell.border = allBorders;
    r++;
  } else {
    jo.segments.forEach((seg, i) => {
      const row = ws.getRow(r);
      ws.getCell(r, 1).value = i + 1;
      // Quantity / unit are per product line. Fall back to the legacy JO-level
      // quantity on the first row for older job orders saved before per-row qty.
      ws.getCell(r, 2).value = seg.quantity || (i === 0 ? jo.quantity : "");
      ws.getCell(r, 3).value = seg.uom || (i === 0 ? jo.uom : "");
      ws.getCell(r, 4).value = formatSegmentDimensions(seg);
      ws.getCell(r, 5).value = segmentTypeLabel(seg);
      ws.getCell(r, 6).value = seg.material;
      ws.getCell(r, 7).value = seg.gauge;
      for (let c = 1; c <= 7; c++) {
        const cell = ws.getCell(r, c);
        cell.font = { size: 10 };
        cell.alignment = { horizontal: c === DIM_COL + 1 ? "left" : "center", vertical: "middle", wrapText: c === DIM_COL + 1 };
        cell.border = allBorders;
        if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
      }
      // Size-transition rows get a subtle emphasis on the type cell.
      if (isReducingDuctType(seg.type)) ws.getCell(r, 5).font = { size: 10, bold: true, color: { argb: RED } };
      row.height = 16;
      r++;
    });
  }

  r++; // spacer

  // --- Note / remarks -----------------------------------------------------
  ws.getCell(`A${r}`).value = "Note / Remarks:";
  ws.getCell(`A${r}`).font = { bold: true, size: 10 };
  r++;
  ws.mergeCells(`A${r}:${LAST}${r + 2}`);
  const note = ws.getCell(`A${r}`);
  note.value = jo.note || "";
  note.font = { size: 10 };
  note.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  note.border = allBorders;
  r += 3;

  r += 2;
  // --- Signatures ---------------------------------------------------------
  const sigTop = { top: { style: "thin" as const, color: { argb: "FF000000" } } };
  // "Prepared by" underline spans B:D, "Received by" spans E:G.
  ws.mergeCells(`B${r}:D${r}`);
  ws.getCell(`B${r}`).value = "Prepared by";
  ws.getCell(`B${r}`).font = { size: 9 };
  ws.getCell(`B${r}`).alignment = { horizontal: "center" };
  for (const col of ["B", "C", "D"]) ws.getCell(`${col}${r}`).border = sigTop;
  ws.mergeCells(`E${r}:G${r}`);
  ws.getCell(`E${r}`).value = "Received by";
  ws.getCell(`E${r}`).font = { size: 9 };
  ws.getCell(`E${r}`).alignment = { horizontal: "center" };
  for (const col of ["E", "F", "G"]) ws.getCell(`${col}${r}`).border = sigTop;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
