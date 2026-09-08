/**
 * The check register as a PDF — see the xlsx route beside this one for why the
 * view is rebuilt from the query string rather than exported whole, and why the
 * Cash position panel is not in it.
 */
import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import React from "react";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { canAttachCheck } from "@/lib/voucher-check";
import { loadCheckRegister } from "@/lib/check-register";
import { buildCheckRegisterView, coerceCheckSort, coerceCheckDir, coerceCheckGroup, coerceCheckTab } from "@/lib/check-register-view";
import { checkExportFileName } from "@/lib/check-register-export";
import { CheckRegisterPdf } from "@/lib/pdf/check-register-pdf";
import { PH_TIME_ZONE } from "@/lib/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return new NextResponse("Unauthorized", { status: 401 });
  const assignments = await getWorkflowRoles();
  const allowed = canAttachCheck({
    admin: isAdmin(viewer),
    workflowRoles: (["accounting", "payment_approver"] as WorkflowRoleKey[]).filter((r) => userHasWorkflowRole(assignments, viewer.id, r)),
  });
  if (!allowed) return new NextResponse("You don't have access to check monitoring.", { status: 403 });

  const todayYMD = new Intl.DateTimeFormat("en-CA", { timeZone: PH_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const rows = await loadCheckRegister(todayYMD);
  const p = req.nextUrl.searchParams;
  const group = coerceCheckGroup(p.get("group"));
  const view = buildCheckRegisterView(rows, {
    tab: coerceCheckTab(p.get("tab")),
    query: p.get("q") ?? "",
    sort: coerceCheckSort(p.get("sort")),
    dir: coerceCheckDir(p.get("dir")),
    group,
  });

  const buf = await renderToBuffer(
    React.createElement(CheckRegisterPdf, { view, group, todayYMD }) as React.ReactElement<DocumentProps>,
  );
  // ?view=1 opens it in the browser instead of downloading — the same trick the
  // expenses report uses for its eye icon.
  const inline = p.get("view") === "1";
  return new NextResponse(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${checkExportFileName(view.tab, todayYMD, "pdf")}"`,
      "Cache-Control": "no-store",
    },
  });
}
