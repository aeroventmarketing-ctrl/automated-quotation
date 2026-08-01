import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { COMPANY } from "@/lib/config";
import { buildSalesReport } from "@/lib/sales-report";

export const runtime = "nodejs";

function ymd(v: string | null, fallback: string): string {
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback;
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const from = ymd(req.nextUrl.searchParams.get("from"), `${today.slice(0, 7)}-01`);
  const to = ymd(req.nextUrl.searchParams.get("to"), today);
  const report = await buildSalesReport(from, to);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("WON Sales Report");
  ws.columns = [
    { width: 14 }, { width: 34 }, { width: 12 }, { width: 9 }, { width: 16 }, { width: 16 }, { width: 16 },
  ];
  const money = '#,##0.00';

  const title = ws.addRow([COMPANY.name]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(title.number, 1, title.number, 7);
  const sub = ws.addRow(["Sales Report — WON Inquiries (per Salesperson)"]);
  sub.font = { bold: true };
  ws.mergeCells(sub.number, 1, sub.number, 7);
  ws.mergeCells(ws.addRow([`${from} to ${to}`]).number, 1, ws.rowCount, 7);
  ws.addRow([]);

  const header = (r: ExcelJS.Row) => { r.font = { bold: true }; r.eachCell((c) => (c.border = { bottom: { style: "thin" } })); };

  for (const g of report.groups) {
    const gh = ws.addRow([g.salesperson, `${g.count} won`]);
    gh.font = { bold: true };
    const head = ws.addRow(["Date", "Customer", "Source", "Quotes", "Value", "Collected", "Balance"]);
    header(head);
    for (const row of g.rows) {
      const r = ws.addRow([row.dateISO.slice(0, 10), row.company, row.source, row.quotes, row.value, row.collected, row.balance]);
      [5, 6, 7].forEach((c) => (r.getCell(c).numFmt = money));
    }
    const st = ws.addRow([`Subtotal · ${g.salesperson}`, "", "", "", g.value, g.collected, g.balance]);
    st.font = { bold: true };
    [5, 6, 7].forEach((c) => (st.getCell(c).numFmt = money));
    ws.addRow([]);
  }

  const gt = ws.addRow([`GRAND TOTAL · ${report.totals.count} won`, "", "", "", report.totals.value, report.totals.collected, report.totals.balance]);
  gt.font = { bold: true, size: 12 };
  gt.eachCell((c) => (c.border = { top: { style: "double" } }));
  [5, 6, 7].forEach((c) => (gt.getCell(c).numFmt = money));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="won-sales-report-${from}_to_${to}.xlsx"`,
    },
  });
}
