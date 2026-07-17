import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { purchaseStepsFrom, PR_STATUS_LABEL, type PRStatus } from "@/lib/purchasing";
import { ReplenishmentList, type PRRow } from "./replenishment-list";

export const dynamic = "force-dynamic";

const CHAIN_ROLES: WorkflowRoleKey[] = ["payment_approver", "accounting", "logistics", "purchaser", "warehouse", "plant_manager"];

export default async function PurchasingPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const admin = isAdmin(viewer);
  const canView = admin || (viewer != null && CHAIN_ROLES.some((r) => userHasWorkflowRole(assignments, viewer.id, r)));

  if (!canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Purchasing</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to purchasing.</p>
      </div>
    );
  }

  let rows: PRRow[] = [];
  let tableMissing = false;
  try {
    const prs = await prisma.purchaseRequest.findMany({
      where: { kind: "replenishment", status: { notIn: ["COMPLETED", "REJECTED"] } },
      orderBy: { createdAt: "asc" },
    });
    const stockIds = [...new Set(prs.map((p) => p.stockItemId).filter((s): s is string => !!s))];
    const stock = stockIds.length
      ? await prisma.stockItem.findMany({ where: { id: { in: stockIds } }, select: { id: true, sku: true, unit: true } })
      : [];
    const stockById = new Map(stock.map((s) => [s.id, s]));
    const prVariant = (s: PRStatus): PRRow["variant"] =>
      s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";
    const stamp = (label: string, who?: string | null, at?: Date | null) =>
      who ? `${label} — ${who} · ${formatDateTime(at ?? undefined)}` : null;
    rows = prs.map((pr) => {
      const status = pr.status as PRStatus;
      const trail = [
        stamp("Requested", pr.createdByName, pr.createdAt),
        stamp(status === "REJECTED" ? "Rejected" : "Approved", pr.decidedByName, pr.decidedAt),
        stamp("Voucher & check", pr.voucherByName, pr.voucherAt),
        stamp("Purchased", pr.purchasedByName, pr.purchasedAt),
        stamp("Checked", pr.checkedByName, pr.checkedAt),
        stamp("Received", pr.receivedByName, pr.receivedAt),
        stamp("Plant Manager approved", pr.plantApprovedByName, pr.plantApprovedAt),
      ].filter((s): s is string => s !== null);
      const actions = purchaseStepsFrom(status).map((step) => ({
        key: step.key,
        label: step.label,
        roleLabel: workflowRoleLabel(step.role),
        canAct: admin || (viewer != null && userHasWorkflowRole(assignments, viewer.id, step.role)),
      }));
      const si = pr.stockItemId ? stockById.get(pr.stockItemId) : undefined;
      return {
        id: pr.id,
        stockItemId: pr.stockItemId ?? "",
        sku: si?.sku ?? null,
        unit: si?.unit ?? "",
        items: Array.isArray(pr.items) ? (pr.items as string[]) : [],
        note: pr.note,
        status,
        statusLabel: PR_STATUS_LABEL[status],
        variant: prVariant(status),
        trail,
        actions,
      };
    });
  } catch {
    tableMissing = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Purchasing</h1>
        <p className="text-sm text-muted-foreground">Replenishment purchase requests — approve, purchase and receive stock top-ups.</p>
      </div>
      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Run migration 0012 in Supabase to enable replenishment purchasing.</CardContent></Card>
      ) : rows.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No open replenishment requests. Raise them from Inventory → Reorder.</CardContent></Card>
      ) : (
        <ReplenishmentList rows={rows} />
      )}
    </div>
  );
}
