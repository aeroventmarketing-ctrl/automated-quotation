import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { ewtPeriod } from "@/lib/ewt-summary";
import { canUseEwtSummary } from "@/lib/ewt-access";
import { loadEwtSummary } from "@/lib/ewt-summary-data";
import { buildEwtXlsx } from "@/lib/excel/ewt-summary-xlsx";

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
  const buf = await buildEwtXlsx(kind, period, kind === "supplier" ? data.supplier : data.client);
  const name = `ewt-summary-${kind === "supplier" ? "1601EQ-supplier" : "1701Q-client"}-${period.key}.xlsx`;
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
