/**
 * Builds an Accessories Job Order workbook from scratch with ExcelJS — a branded
 * header, the JO number + due date, then a table of accessory product lines
 * (qty, dimensions, type, material), followed by the remarks/note.
 */
import ExcelJS from "exceljs";
import { COMPANY } from "@/lib/config";
import { formatAccessoryDimensions, accessoriesJobRemarks, formatMaterialText, type AccessoriesJobOrder } from "@/lib/accessories-job-order";

const RED = "FFED1C24";
const GREY = "FFF2F2F2";
const BORDER = "FFBFBFBF";

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "long", day: "numeric" }).format(d);
}

export async function buildAccessoriesJobOrderWorkbook(jo: AccessoriesJobOrder): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = COMPANY.name;
  const ws = wb.addWorksheet("Accessories Job Order", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    views: [{ showGridLines: false, style: "pageBreakPreview", zoomScale: 120, zoomScaleNormal: 120 }],
  });

  // # | Qty | Dimensions | Product type | Material
  ws.columns = [{ width: 5 }, { width: 8 }, { width: 40 }, { width: 20 }, { width: 18 }];
  const LAST = "E";

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
  doctype.value = "ACCESSORIES JOB ORDER";
  doctype.font = { bold: true, size: 13 };
  doctype.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(3).height = 20;

  // --- JO number / project / dates ---------------------------------------
  let r = 5;
  const infoRow = (label: string, value: string, label2?: string, value2?: string) => {
    const row = ws.getRow(r);
    ws.getCell(`A${r}`).value = label;
    ws.getCell(`A${r}`).font = { bold: true, size: 10 };
    ws.mergeCells(`B${r}:C${r}`);
    ws.getCell(`B${r}`).value = value;
    ws.getCell(`B${r}`).font = { size: 10 };
    if (label2 != null) {
      ws.getCell(`D${r}`).value = label2;
      ws.getCell(`D${r}`).font = { bold: true, size: 10 };
      ws.getCell(`D${r}`).alignment = { horizontal: "right" };
      ws.getCell(`E${r}`).value = value2 ?? "";
      ws.getCell(`E${r}`).font = { size: 10 };
    }
    row.height = 16;
    r++;
  };
  infoRow("JO No.:", jo.joNumber, "Date:", fmtDate(jo.date));
  infoRow("Project:", jo.project, "Due:", fmtDate(jo.dueDate));
  ws.getCell("B5").font = { bold: true, size: 11, color: { argb: RED } };
  ws.getCell("E6").font = { bold: true, size: 10, color: { argb: RED } };

  r++; // spacer

  // --- Lines table --------------------------------------------------------
  const headerRow = r;
  const headers = ["#", "Qty", "Dimensions", "Product type", "Material"];
  headers.forEach((h, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
    cell.alignment = { horizontal: i === 2 ? "left" : "center", vertical: "middle", wrapText: true };
    cell.border = allBorders;
  });
  ws.getRow(headerRow).height = 22;
  r++;

  if (jo.lines.length === 0) {
    ws.mergeCells(`A${r}:${LAST}${r}`);
    const cell = ws.getCell(r, 1);
    cell.value = "No accessory products listed.";
    cell.font = { italic: true, size: 10, color: { argb: "FF888888" } };
    cell.alignment = { horizontal: "center" };
    cell.border = allBorders;
    r++;
  } else {
    jo.lines.forEach((line, i) => {
      const row = ws.getRow(r);
      ws.getCell(r, 1).value = i + 1;
      ws.getCell(r, 2).value = [line.quantity, line.uom].filter(Boolean).join(" ");
      ws.getCell(r, 3).value = formatAccessoryDimensions(line);
      ws.getCell(r, 4).value = line.type;
      ws.getCell(r, 5).value = formatMaterialText(line.material);
      for (let c = 1; c <= 5; c++) {
        const cell = ws.getCell(r, c);
        cell.font = { size: 10 };
        cell.alignment = { horizontal: c === 3 ? "left" : "center", vertical: "middle", wrapText: c === 3 || c === 4 };
        cell.border = allBorders;
        if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY } };
      }
      ws.getCell(r, 4).font = { size: 10, bold: true, color: { argb: RED } };
      row.height = 18;
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
  note.value = accessoriesJobRemarks(jo);
  note.font = { size: 10 };
  note.alignment = { horizontal: "left", vertical: "top", wrapText: true };
  note.border = allBorders;
  r += 3;

  r += 2;
  // --- Signatures ---------------------------------------------------------
  ws.getCell(`B${r}`).value = "Prepared by";
  ws.getCell(`B${r}`).font = { size: 9 };
  ws.getCell(`B${r}`).alignment = { horizontal: "center" };
  ws.getCell(`B${r}`).border = { top: { style: "thin", color: { argb: "FF000000" } } };
  ws.getCell(`D${r}`).value = "Received by";
  ws.getCell(`D${r}`).font = { size: 9 };
  ws.getCell(`D${r}`).alignment = { horizontal: "center" };
  ws.getCell(`D${r}`).border = { top: { style: "thin", color: { argb: "FF000000" } } };

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
