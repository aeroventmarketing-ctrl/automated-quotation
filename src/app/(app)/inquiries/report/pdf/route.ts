import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { getCurrentUser } from "@/lib/auth";
import { buildSalesReport, type ReportBasis } from "@/lib/sales-report";
import { SalesReportPdf } from "@/lib/pdf/sales-report-pdf";

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
  const basis: ReportBasis = req.nextUrl.searchParams.get("basis") === "won" ? "won" : "created";
  const report = await buildSalesReport(from, to, basis);

  const buf = await renderToBuffer(React.createElement(SalesReportPdf, { report }) as React.ReactElement<DocumentProps>);
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="won-sales-report-${from}_to_${to}.pdf"`,
    },
  });
}
