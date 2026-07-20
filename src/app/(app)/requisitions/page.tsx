import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { PRODUCTION_DEPTS, deptRole } from "@/lib/order-workflow";
import { buildPurchaseChainRow } from "@/lib/purchase-chain-row";
import { getProducts } from "@/lib/product-catalog";
import { getSuppliers } from "@/lib/suppliers";
import { getPaymentTerms } from "@/lib/payment-terms";
import { COMPANY } from "@/lib/config";
import { RequisitionForm } from "./requisition-form";
import { PurchasingChain } from "../orders/[id]/purchasing-chain";

export const dynamic = "force-dynamic";

export default async function RequisitionsPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const admin = isAdmin(viewer);
  const has = (r: WorkflowRoleKey) => viewer != null && userHasWorkflowRole(assignments, viewer.id, r);
  const purchaser = admin || has("purchaser");
  // Which departments the viewer heads.
  const ownDeptKeys = viewer == null ? [] : PRODUCTION_DEPTS.filter((d) => has(deptRole(d.key) as WorkflowRoleKey)).map((d) => d.key);
  const canRaise = admin || purchaser || ownDeptKeys.length > 0;

  if (!canRaise) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Requisitions</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to raise department requisitions. Ask an admin for a production-head or purchaser role.</p>
      </div>
    );
  }

  const raisableDepts = (admin || purchaser ? PRODUCTION_DEPTS.map((d) => d.key) : ownDeptKeys);
  const [products, suppliers, paymentTerms, stockItems, allUsers] = await Promise.all([
    getProducts().catch(() => []),
    getSuppliers().catch(() => []),
    getPaymentTerms().catch(() => []),
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }).catch(() => []),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const userName = new Map(allUsers.map((u) => [u.id, u.name] as const));
  const namesForRole = (role: WorkflowRoleKey): string[] =>
    usersWithWorkflowRole(assignments, role).map((uid) => userName.get(uid)).filter((n): n is string => !!n);
  // Real role check so the voucher reconciliation (and its AI receipt reader) is
  // usable here by the Purchaser / Accounting / Approver — the rest of the chain
  // stays read-only (processed in Purchasing).
  const canAct = (role: WorkflowRoleKey): boolean => admin || has(role);

  // The viewer's requisitions (their departments; purchaser/admin see all active).
  let rows: ReturnType<typeof buildPurchaseChainRow>[] = [];
  let tableMissing = false;
  try {
    const prs = await prisma.purchaseRequest.findMany({
      where: {
        kind: "department",
        status: { notIn: ["COMPLETED"] },
        ...(admin || purchaser ? {} : { dept: { in: ownDeptKeys } }),
      },
      orderBy: { createdAt: "desc" },
    });
    rows = prs.map((pr) => buildPurchaseChainRow(pr, { mrfNo: null, canManagePO: false, namesForRole, canAct }));
  } catch {
    tableMissing = true;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Requisitions</h1>
        <p className="text-sm text-muted-foreground">Department requests for production supplies, consumables and equipment. The purchaser processes them in Purchasing; received items go into stock.</p>
      </div>

      <RequisitionForm depts={PRODUCTION_DEPTS.filter((d) => raisableDepts.includes(d.key)).map((d) => ({ key: d.key, label: d.label }))} products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }))} />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">My requisitions</h2>
        {tableMissing ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Purchasing isn&apos;t set up yet.</CardContent></Card>
        ) : rows.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No open requisitions.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <PurchasingChain
                requests={rows}
                stockItems={stockItems}
                orderId=""
                poDefaultRemarks={COMPANY.poDefaultRemarks}
                suppliers={suppliers}
                paymentTerms={paymentTerms}
                canManagePO={false}
                readOnly
                poRoute="purchasing"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
