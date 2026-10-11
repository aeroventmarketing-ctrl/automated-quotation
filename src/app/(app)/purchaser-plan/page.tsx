import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { purchaserPlanAccess } from "@/lib/purchaser-plan-access";
import { loadPurchaserPlan } from "@/lib/purchaser-plan-data";
import { PurchaserPlanTable } from "./plan-table";

export const dynamic = "force-dynamic";

/**
 * The Purchaser Plan — the owner's *PURCHASER TABLE updated.xlsx* ("Test 1"),
 * live: one row per open MRF on a paid order. Opened from its tile on My
 * Dashboard. See `lib/purchaser-plan` for what each column is and why.
 */
export default async function PurchaserPlanPage() {
  const [viewer, roles] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const { canView, canEdit } = purchaserPlanAccess(viewer, roles);

  if (!viewer || !canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Purchaser Plan</h1>
        <p className="text-sm text-muted-foreground">
          The Purchaser Plan is for the Purchaser, Engineers, the Payment Approver and admins.
        </p>
      </div>
    );
  }

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
        <h1 className="text-2xl font-bold">Purchaser Plan</h1>
        <p className="text-sm text-muted-foreground">
          Every open MRF on a paid order. Type and Client due date are yours to fill in; the rest comes straight from the order and Purchasing.
        </p>
      </div>
      {failed ? (
        <p className="text-sm text-destructive">The plan couldn&apos;t be loaded just now. Refresh to try again.</p>
      ) : (
        <PurchaserPlanTable rows={data.rows} canEdit={canEdit} tableMissing={data.tableMissing} />
      )}
    </div>
  );
}
