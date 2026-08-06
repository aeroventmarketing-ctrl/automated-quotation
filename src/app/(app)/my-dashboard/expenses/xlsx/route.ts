import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser } from "@/lib/auth";
import { COMPANY } from "@/lib/config";
import { getExpensesReport } from "@/app/(app)/management/pnl-actions";
import { buildExpensesView, coerceSort, coerceGroup, coerceDir, EXPENSE_GROUPS } from "@/lib/expenses-view";

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
  const group = coerceGroup(req.nextUrl.searchParams.get("group"));

  let report;
  try {
    report = await getExpensesReport(from, to);
  } catch (e) {
    return new NextResponse(e instanceof Error ? e.message : "Forbidden", { status: 403 });
  }
  const view = buildExpensesView(report.records, {
    query: req.nextUrl.searchParams.get("q") ?? "",
    sort: coerceSort(req.nextUrl.searchParams.get("sort")),
    dir: coerceDir(req.nextUrl.searchParams.get("dir")),
    group,
  });
  const groupLabel = EXPENSE_GROUPS.find((g) => g.key === group)!.label;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Expenses");
  ws.columns = [{ width: 12 }, { width: 14 }, { width: 22 }, { width: 16 }, { width: 20 }, { width: 30 }, { width: 16 }];
  const money = "#,##0.00";

  const title = ws.addRow([COMPANY.name]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(title.number, 1, title.number, 7);
  const sub = ws.addRow(["Expenses Records"]);
  sub.font = { bold: true };
  ws.mergeCells(sub.number, 1, sub.number, 7);
  const meta = ws.addRow([`${report.from} to ${report.to} · ${view.count} record${view.count === 1 ? "" : "s"}${group !== "none" ? ` · grouped by ${groupLabel}` : ""}`]);
  ws.mergeCells(meta.number, 1, meta.number, 7);
  ws.addRow([]);

  const HEADERS = ["Date", "Source", "Reference", "Department", "Who", "Detail", "Amount"];
  const writeHeader = () => {
    const r = ws.addRow(HEADERS);
    r.font = { bold: true };
    r.eachCell((c) => (c.border = { bottom: { style: "thin" } }));
  };

  if (view.count === 0) {
    ws.addRow(["No expenses recorded in this range."]);
  } else if (group === "none") {
    writeHeader();
    for (const g of view.groups) for (const row of g.rows) {
      const r = ws.addRow([row.date, row.source, row.ref, row.deptLabel, row.who, row.detail, row.amount]);
      r.getCell(7).numFmt = money;
    }
  } else {
    for (const g of view.groups) {
      const gh = ws.addRow([`${groupLabel}: ${g.key || "—"}`, "", "", "", "", "", g.subtotal]);
      gh.font = { bold: true };
      gh.getCell(7).numFmt = money;
      writeHeader();
      for (const row of g.rows) {
        const r = ws.addRow([row.date, row.source, row.ref, row.deptLabel, row.who, row.detail, row.amount]);
        r.getCell(7).numFmt = money;
      }
      const st = ws.addRow([`Subtotal · ${g.key || "—"}`, "", "", "", "", "", g.subtotal]);
      st.font = { bold: true };
      st.getCell(7).numFmt = money;
      ws.addRow([]);
    }
  }

  const gt = ws.addRow([`GRAND TOTAL · ${view.count} record${view.count === 1 ? "" : "s"}`, "", "", "", "", "", view.total]);
  gt.font = { bold: true, size: 12 };
  gt.eachCell((c) => (c.border = { top: { style: "double" } }));
  gt.getCell(7).numFmt = money;

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="expenses-${report.from}_to_${report.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
