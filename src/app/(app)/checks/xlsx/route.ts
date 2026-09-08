/**
 * The check register as a spreadsheet — the owner's *"add an option to download
 * in excel file and pdf file."*
 *
 * It exports the register the person is LOOKING at, not "all checks": the tab,
 * the search, the sort and the grouping ride in the query string and are rebuilt
 * here through `buildCheckRegisterView`, the same function the screen uses. Two
 * implementations of "sorted by clearing date" would drift the first time either
 * was touched.
 *
 * NOT included: the Cash position panel underneath the register. That is the
 * bank balance, and it belongs to an admin or the Payment Approver only (see
 * `canSeeCashPosition`); a download that carried it would hand it to Accounting
 * by the back door.
 */
import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { canAttachCheck } from "@/lib/voucher-check";
import { loadCheckRegister } from "@/lib/check-register";
import { buildCheckRegisterView, coerceCheckSort, coerceCheckDir, coerceCheckGroup, coerceCheckTab, CHECK_GROUP_LABEL } from "@/lib/check-register-view";
import { checkRegisterRow, CHECK_EXPORT_HEADERS, checkExportFileName } from "@/lib/check-register-export";
import { PH_TIME_ZONE } from "@/lib/utils";
import { COMPANY } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const viewer = await getCurrentUser();
  if (!viewer) return new NextResponse("Unauthorized", { status: 401 });
  // The same audience as the page itself — Accounting, the Payment Approver, an
  // admin. A download must never be a way around a screen.
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

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Check register");
  ws.columns = [{ width: 12 }, { width: 30 }, { width: 24 }, { width: 14 }, { width: 14 }, { width: 13 }, { width: 10 }, { width: 18 }, { width: 26 }];
  const money = "#,##0.00";
  const COLS = CHECK_EXPORT_HEADERS.length;
  const AMOUNT_COL = CHECK_EXPORT_HEADERS.indexOf("Amount") + 1;

  const title = ws.addRow([COMPANY.name]);
  title.font = { bold: true, size: 14 };
  ws.mergeCells(title.number, 1, title.number, COLS);
  const sub = ws.addRow(["Check monitoring"]);
  sub.font = { bold: true };
  ws.mergeCells(sub.number, 1, sub.number, COLS);
  const meta = ws.addRow([`${view.caption} · as of ${todayYMD}`]);
  ws.mergeCells(meta.number, 1, meta.number, COLS);
  ws.addRow([]);

  const writeHeader = () => {
    const r = ws.addRow([...CHECK_EXPORT_HEADERS]);
    r.font = { bold: true };
    r.eachCell((c) => (c.border = { bottom: { style: "thin" } }));
  };
  const writeRow = (values: (string | number | null)[]) => {
    const r = ws.addRow(values);
    r.getCell(AMOUNT_COL).numFmt = money;
  };

  if (view.count === 0) {
    ws.addRow(["Nothing to show for this arrangement."]);
  } else if (group === "none") {
    writeHeader();
    for (const g of view.groups) for (const row of g.rows) writeRow(checkRegisterRow(row));
  } else {
    for (const g of view.groups) {
      const gh = ws.addRow([`${CHECK_GROUP_LABEL[group]}: ${g.label || "—"}`]);
      gh.font = { bold: true };
      gh.getCell(AMOUNT_COL).value = g.total;
      gh.getCell(AMOUNT_COL).numFmt = money;
      writeHeader();
      for (const row of g.rows) writeRow(checkRegisterRow(row));
      const st = ws.addRow([`Subtotal · ${g.label || "—"}`]);
      st.font = { bold: true };
      st.getCell(AMOUNT_COL).value = g.total;
      st.getCell(AMOUNT_COL).numFmt = money;
      ws.addRow([]);
    }
  }

  const gt = ws.addRow([`TOTAL · ${view.count} check${view.count === 1 ? "" : "s"}`]);
  gt.font = { bold: true, size: 12 };
  gt.getCell(AMOUNT_COL).value = view.total;
  gt.getCell(AMOUNT_COL).numFmt = money;
  gt.eachCell((c) => (c.border = { top: { style: "double" } }));

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${checkExportFileName(view.tab, todayYMD, "xlsx")}"`,
      "Cache-Control": "no-store",
    },
  });
}
