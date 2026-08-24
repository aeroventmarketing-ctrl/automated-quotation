import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { COMPANY } from "@/lib/config";
import { buildSalesSummary } from "@/lib/sales-summary";

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
  const report = await buildSalesSummary(from, to);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sales Summary (Vatable)");
  ws.columns = [
    { width: 12 }, { width: 16 }, { width: 12 }, { width: 12 }, { width: 34 }, { width: 20 }, { width: 16 }, { width: 14 }, { width: 40 },
  ];
  const money = '#,##0.00';
  const LAST = 9;

  const title = ws.addRow([COMPANY.name]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(title.number, 1, title.number, LAST);
  const sub = ws.addRow(["Sales Summary (Vatable)"]);
  sub.font = { bold: true };
  ws.mergeCells(sub.number, 1, sub.number, LAST);
  ws.mergeCells(ws.addRow([`${from} to ${to} · by Payment date`]).number, 1, ws.rowCount, LAST);
  ws.addRow([]);

  const head = ws.addRow(["Date", "SI Number", "CR", "DR", "Company", "TIN Number", "P.O. Amount", "EWT FP", "Company Address"]);
  head.font = { bold: true };
  head.eachCell((c) => (c.border = { bottom: { style: "thin" } }));

  const dash = (v: string) => (v.trim() ? v : "—");
  for (const r of report.rows) {
    const row = ws.addRow([
      r.dateISO.slice(0, 10), dash(r.siNumber), dash(r.crNumber), dash(r.drNumber),
      r.company, dash(r.tin), r.poAmount, r.ewt, dash(r.address),
    ]);
    [7, 8].forEach((c) => (row.getCell(c).numFmt = money));
  }

  const gt = ws.addRow([`GRAND TOTAL · ${report.totals.count} sale${report.totals.count === 1 ? "" : "s"}`, "", "", "", "", "", report.totals.poAmount, report.totals.ewt, ""]);
  gt.font = { bold: true, size: 12 };
  gt.eachCell((c) => (c.border = { top: { style: "double" } }));
  [7, 8].forEach((c) => (gt.getCell(c).numFmt = money));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sales-summary-vatable-${from}_to_${to}.xlsx"`,
    },
  });
}
