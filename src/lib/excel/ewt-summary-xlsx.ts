/**
 * One EWT table as .xlsx, laid out like the owner's *SAMPLE TEMPLATE FOR EWT by
 * Rey.xlsx*: EWT SUMMARY (A1:E1), the generation line (A2:E2), the headers on
 * row 4, rows from 5, with column G a live `=F/1.12` and the same number formats.
 */
import ExcelJS from "exceljs";
import { ewtStatus, ewtTotals, EWT_TABLE_TITLE, type EwtKind, type EwtPeriod, type EwtRow } from "@/lib/ewt-summary";

const MONEY = '_-* #,##0.00_-;-* #,##0.00_-;_-* "-"??_-;_-@_-';

export async function buildEwtXlsx(kind: EwtKind, period: EwtPeriod, rows: EwtRow[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(kind === "supplier" ? "1601-EQ Supplier EWT" : "1701Q Client EWT");

  ws.mergeCells("A1:E1");
  ws.getCell("A1").value = "EWT SUMMARY";
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.mergeCells("A2:E2");
  ws.getCell("A2").value = `Generation: ${period.mode === "quarter" ? "Quarterly" : "Monthly"} — ${period.label} · ${EWT_TABLE_TITLE[kind]}`;
  ws.getCell("A2").font = { bold: true };

  const headers = [
    "DATE",
    "REGISTERED NAME",
    kind === "supplier" ? "SUPPLIER'S ADDRESS" : "CLIENT'S ADDRESS",
    "TIN",
    "S.I. #",
    kind === "supplier" ? "GROSS TAXABLE PURCHASE" : "GROSS TAXABLE SALE",
    "NET OF VAT",
    "EWT",
    "Status",
    "POP",
  ];
  const head = ws.getRow(4);
  headers.forEach((h, i) => (head.getCell(i + 1).value = h));
  head.font = { bold: true };
  head.alignment = { vertical: "middle", wrapText: true };

  let r = 5;
  for (const row of rows) {
    const x = ws.getRow(r);
    const [y, m, d] = row.date.split("-").map(Number);
    x.getCell(1).value = new Date(Date.UTC(y, m - 1, d));
    x.getCell(1).numFmt = "mm/dd/yyyy;@";
    x.getCell(2).value = row.registeredName;
    x.getCell(3).value = row.address;
    x.getCell(4).value = row.tin;
    x.getCell(5).value = row.siNumber;
    x.getCell(6).value = row.gross;
    // The template's formula where VAT applies; a sale with no VAT carries the gross.
    x.getCell(7).value = row.netOfVat === row.gross ? row.gross : { formula: `F${r}/1.12`, result: row.netOfVat };
    // The EWT actually withheld — the PO's own / the client's recorded amount.
    x.getCell(8).value = row.ewt;
    x.getCell(9).value = ewtStatus(row);
    x.getCell(10).value = row.pop?.name ?? "";
    for (const c of [6, 7, 8]) x.getCell(c).numFmt = MONEY;
    r++;
  }

  const t = ewtTotals(rows);
  const tot = ws.getRow(r + 1);
  tot.getCell(5).value = "TOTAL";
  if (rows.length) {
    tot.getCell(6).value = { formula: `SUM(F5:F${r - 1})`, result: t.gross };
    tot.getCell(7).value = { formula: `SUM(G5:G${r - 1})`, result: t.netOfVat };
    tot.getCell(8).value = { formula: `SUM(H5:H${r - 1})`, result: t.ewt };
  }
  for (const c of [6, 7, 8]) tot.getCell(c).numFmt = MONEY;
  tot.font = { bold: true };

  [12, 34, 34, 20, 14, 18, 16, 14, 10, 30].forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
