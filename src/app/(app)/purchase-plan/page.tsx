import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { purchaserPlanAccess } from "@/lib/purchaser-plan-access";
import { loadPurchaserPlan } from "@/lib/purchaser-plan-data";
import { PurchaserPlanTable } from "./plan-table";

export const dynamic = "force-dynamic";

/**
 * The Purchase Plan (first built as the "Purchaser Plan") — the owner's *PURCHASER TABLE updated.xlsx* ("Test 1"),
 * live: one row per open MRF on a paid order. Opened from its tile on My
 * Dashboard. See `lib/purchaser-plan` for what each column is and why.
 */
export default async function PurchasePlanPage() {
  const [viewer, roles] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const { canView, canEditType, canEditClientDue } = purchaserPlanAccess(viewer, roles);

  if (!viewer || !canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Purchase Plan</h1>
        <p className="text-sm text-muted-foreground">
          The Purchase Plan is for the Purchaser, Sales, Engineers, the Payment Approver and admins.
        </p>
      </div>
    );
  }

  // Manila "today", decided on the server, so the due-date colours read the same
  // for every viewer whatever their computer's clock or timezone says.
  const todayYMD = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  let failed = false;
  let data: Awaited<ReturnType<typeof loadPurchaserPlan>> = { rows: [], tableMissing: false };
  try {
    data = await loadPurchaserPlan();
  } catch {
    failed = true;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Purchase Plan</h1>
        <p className="text-sm text-muted-foreground">
          Every open MRF on a paid order. Type and Client due date are filled in by people; the rest comes straight from the order and Purchasing.
        </p>
      </div>
      {failed ? (
        <p className="text-sm text-destructive">The plan couldn&apos;t be loaded just now. Refresh to try again.</p>
      ) : (
        <PurchaserPlanTable rows={data.rows} canEditType={canEditType} canEditClientDue={canEditClientDue} tableMissing={data.tableMissing} todayYMD={todayYMD} />
      )}
    </div>
  );
}
