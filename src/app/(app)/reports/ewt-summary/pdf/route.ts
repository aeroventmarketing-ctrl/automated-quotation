import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { ewtPeriod } from "@/lib/ewt-summary";
import { canUseEwtSummary } from "@/lib/ewt-access";
import { loadEwtSummary } from "@/lib/ewt-summary-data";
import { EwtSummaryPdf } from "@/lib/pdf/ewt-summary-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!canUseEwtSummary(user, await getWorkflowRoles())) return new NextResponse("Forbidden", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("table") === "client" ? "client" : "supplier";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const period = ewtPeriod(sp.get("mode") ?? undefined, sp.get("period") ?? undefined, today);
  const data = await loadEwtSummary(period, kind);
  const rows = kind === "supplier" ? data.supplier : data.client;
  const buf = await renderToBuffer(React.createElement(EwtSummaryPdf, { kind, period, rows }) as React.ReactElement<DocumentProps>);
  const name = `ewt-summary-${kind === "supplier" ? "1601EQ-supplier" : "1701Q-client"}-${period.key}.pdf`;
  return new NextResponse(buf as unknown as BodyInit, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
