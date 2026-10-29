import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { purchaserPlanAccess } from "@/lib/purchaser-plan-access";
import { canViewSupplier } from "@/lib/price-visibility";
import { loadPurchaserPlan } from "@/lib/purchaser-plan-data";
import { PurchaserPlanTable } from "./plan-table";
import { ClosedPlanBox } from "./closed-box";

export const dynamic = "force-dynamic";

/**
 * The Purchase Plan (first built as the "Purchaser Plan") — the owner's *PURCHASER TABLE updated.xlsx* ("Test 1"),
 * live: one row per open MRF on a paid order, plus one per approved / budgeted
 * PO not raised from an MRF. Opened from its tile on My
 * Dashboard. See `lib/purchaser-plan` for what each column is and why.
 */
export default async function PurchasePlanPage() {
  const [viewer, roles] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const { canView, canEditType } = purchaserPlanAccess(viewer, roles);
  // The PO document names the supplier and carries the prices, so its link goes
  // to the same people who see supplier names elsewhere; Sales see the number only.
  const canOpenPo = canViewSupplier(viewer, roles);

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
  let data: Awaited<ReturnType<typeof loadPurchaserPlan>> = { rows: [], closed: [], tableMissing: false };
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
          Every open MRF on a paid order, and every PO in Purchasing&apos;s Approved or Budgeted tab that wasn&apos;t raised from an MRF. Type is filled in here; the Client due date comes from the order (set in its Phase 1 box); the rest comes straight from the order and Purchasing.
        </p>
      </div>
      {failed ? (
        <p className="text-sm text-destructive">The plan couldn&apos;t be loaded just now. Refresh to try again.</p>
      ) : (
        <>
          <PurchaserPlanTable rows={data.rows} canEditType={canEditType} tableMissing={data.tableMissing} todayYMD={todayYMD} canOpenPo={canOpenPo} />
          <ClosedPlanBox rows={data.closed} canOpenPo={canOpenPo} />
        </>
      )}
    </div>
  );
}
