import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { AutoRefresh } from "@/components/auto-refresh";
import { Card, CardContent } from "@/components/ui/card";
import { coerceCheckDocs, canAttachCheck } from "@/lib/voucher-check";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { buildCheckWatch, checkWatchSummary, CHECK_NOTICE_DAYS } from "@/lib/check-monitor";
import { PH_TIME_ZONE } from "@/lib/utils";
import { CheckMonitor } from "./check-monitor-table";

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

  // Every PO that carries a check photo. A check clears long after its PO is
  // finished, so no status filter here — a COMPLETED PO's check still clears.
  const prs = await prisma.purchaseRequest
    .findMany({ select: { id: true, quotationId: true, po: true, voucherCheckDocs: true } })
    .catch(() => []);

  const rows = buildCheckWatch(prs, todayYMD, {
    coerceDocs: coerceCheckDocs,
    poOf: (v) => {
      const po = coercePurchaseOrder(v);
      return po ? { poNumber: po.poNumber, supplierCompany: po.supplier.company, date: po.date || null } : null;
    },
  });
  const summary = checkWatchSummary(rows);

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={60} />
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Check monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Every check issued to a supplier, by the day it clears. Checks needing attention are those clearing within{" "}
          {CHECK_NOTICE_DAYS} days, today, or already past without being cleared.
        </p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            No checks are being monitored yet. A check appears here once its photo is attached to a purchase order and read.
          </CardContent>
        </Card>
      ) : (
        <CheckMonitor rows={rows} summary={summary} admin={admin} todayYMD={todayYMD} />
      )}
    </div>
  );
}
