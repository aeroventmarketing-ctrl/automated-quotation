import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent } from "@/components/ui/card";
import { canAttachCheck } from "@/lib/voucher-check";
import { checkWatchSummary, CHECK_NOTICE_DAYS } from "@/lib/check-monitor";
import { loadCheckRegister } from "@/lib/check-register";
import { PH_TIME_ZONE } from "@/lib/utils";
import { getCashPosition, computeCashPosition, EMPTY_CASH_POSITION } from "@/lib/cash-position";
import { getReceivablesOutstanding } from "@/lib/receivables";
import { CheckMonitor } from "./check-monitor-table";
import { CashPositionPanel } from "./cash-position-panel";

export const dynamic = "force-dynamic";

/**
 * Check monitoring — every check we have issued, watched towards the day it
 * clears, with the cleared ones on their own tab.
 *
 * Who sees it and who may act are deliberately different. Accounting and the
 * Payment Approver attach and read the checks, so they can SEE the schedule.
 * Clearing one and moving its date are **admin only** — the owner's answer when
 * asked directly.
 */
export default async function ChecksPage() {
  const viewer = await getCurrentUser();
  if (!viewer) return null;
  const assignments = await getWorkflowRoles();
  const admin = isAdmin(viewer);
  const canView = canAttachCheck({
    admin,
    workflowRoles: (["accounting", "payment_approver"] as WorkflowRoleKey[]).filter((r) => userHasWorkflowRole(assignments, viewer.id, r)),
  });

  if (!canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Check monitoring</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to check monitoring.</p>
      </div>
    );
  }

  const todayYMD = new Intl.DateTimeFormat("en-CA", { timeZone: PH_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  const rows = await loadCheckRegister(todayYMD);

  const summary = checkWatchSummary(rows);
  // The cash position sits under the register and is driven by it: First
  // Priority and Total Payables are the register's own totals, never re-derived.
  const [saved, receivables] = await Promise.all([
    getCashPosition().catch(() => EMPTY_CASH_POSITION),
    // The same figure as the Management Dashboard's Receivables tile.
    getReceivablesOutstanding().catch(() => 0),
  ]);
  const cash = computeCashPosition(saved, {
    firstPriority: summary.firstPriorityAmount,
    totalPayables: summary.openAmount,
    receivables,
  });

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={60} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Check monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Every check issued to a supplier, by the day it clears — plus the POs still <em>for payment</em>, whose
          check has not been written yet. Checks needing attention are those clearing within {CHECK_NOTICE_DAYS}{" "}
          days, today, or already past without being cleared.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Nothing to monitor yet. A purchase order appears here once it is due to be paid by check, and fills in
            with its number, amount and clearing date once the photo of that check is attached and read.
          </CardContent>
        </Card>
      ) : (
        <>
          <CheckMonitor rows={rows} summary={summary} admin={admin} todayYMD={todayYMD} />
          <CashPositionPanel pos={cash} admin={admin} />
        </>
      )}
    </div>
  );
}
