import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { inventoryAccess } from "@/lib/catalogue-access";
import { getApprovalHistory } from "@/lib/approval-history";
import { Card, CardContent } from "@/components/ui/card";
import { ApprovalList } from "./approval-list";

export const dynamic = "force-dynamic";

/**
 * The catalogue approval record — every request that has been approved or
 * rejected, with the signatures that decided it.
 *
 * The pending card on Inventory shows a request only while it is still waiting;
 * the moment the last signature lands it applies and the card disappears. This
 * is where it goes afterwards. Nothing new is stored — see lib/approval-history.
 *
 * Access is `canViewApprovalHistory`, asserted for every role in
 * `catalogue-access.test.ts`, so the nav link and the page cannot disagree about
 * who may open it.
 */
export default async function ApprovalHistoryPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const { canViewApprovalHistory } = inventoryAccess(viewer, assignments);

  if (!canViewApprovalHistory) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Approval history</h1>
        <p className="text-sm text-muted-foreground">
          Only the Warehouse, Purchaser, Payment Approver and admins can read the catalogue approval record.
        </p>
      </div>
    );
  }

  const records = await getApprovalHistory();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/inventory" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Inventory
        </Link>
        <h1 className="mt-1 text-2xl font-bold">Approval history</h1>
        <p className="text-sm text-muted-foreground">
          Every Inventory and Products request that has been decided, with who raised it, who signed it, and when.
          A request in progress is on the item&apos;s own row until its last signature lands.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ApprovalList records={records} />
        </CardContent>
      </Card>
    </div>
  );
}
