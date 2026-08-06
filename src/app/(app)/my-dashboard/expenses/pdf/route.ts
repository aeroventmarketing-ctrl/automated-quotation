import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { getCurrentUser } from "@/lib/auth";
import { getExpensesReport } from "@/app/(app)/management/pnl-actions";
import { buildExpensesView, coerceSort, coerceGroup, coerceDir } from "@/lib/expenses-view";
import { ExpensesReportPdf } from "@/lib/pdf/expenses-report-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const buf = await renderToBuffer(
    React.createElement(ExpensesReportPdf, { view, from: report.from, to: report.to, group }) as React.ReactElement<DocumentProps>,
  );
  // ?view=1 opens the PDF inline in the browser (the eye view); otherwise it downloads.
  const inline = req.nextUrl.searchParams.get("view") === "1";
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="expenses-${report.from}_to_${report.to}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
