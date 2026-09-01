import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { listStockItemsWithAvailability } from "@/lib/inventory";
import { AutoRefresh } from "@/components/auto-refresh";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { PRODUCTION_DEPTS, REQUISITION_DEPTS, deptRole, requestorDeptKey, requisitionDeptLabel } from "@/lib/order-workflow";
import { buildPurchaseChainRow } from "@/lib/purchase-chain-row";
import { getProducts } from "@/lib/product-catalog";
import { getSuppliers } from "@/lib/suppliers";
import { getPaymentTerms } from "@/lib/payment-terms";
import { canViewOrderAmounts, canViewSupplier } from "@/lib/price-visibility";
import { COMPANY } from "@/lib/config";
import { RequisitionForm } from "./requisition-form";
import { RequisitionsList } from "./requisitions-list";

export const dynamic = "force-dynamic";

export default async function RequisitionsPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const admin = isAdmin(viewer);
  const has = (r: WorkflowRoleKey) => viewer != null && userHasWorkflowRole(assignments, viewer.id, r);
  const purchaser = admin || has("purchaser");
  const isSales = viewer?.role === "SALES";
  // Which departments the viewer heads.
  const ownDeptKeys = viewer == null ? [] : PRODUCTION_DEPTS.filter((d) => has(deptRole(d.key) as WorkflowRoleKey)).map((d) => d.key);
  // Office-type raisers (plant manager, warehouse, logistics, the Technical Head,
  // sales, the Payment Approver) may raise requisitions for their own department.
  // The Payment Approver is here on the owner's instruction — *"enable
  // requisitions for payment approver"*.
  //
  // **Accounting and Engineers are NOT** — owner's ruling: *"Accounting and
  // Engineer are not allowed to make a requisition."* They used to be listed
  // here, which offered them the whole form; `createDepartmentRequisition` then
  // refused the Submit with *"You don't have access to raise a requisition."*
  // The server was right and this list was wrong, so the list moved to match it.
  // Any change here needs the matching change in that action, or the two drift
  // apart again.
  const officeRaiser =
    isSales || has("payment_approver") || has("plant_manager") ||
    has("warehouse") || has("logistics") || has("technical_head");
  const canRaise = admin || purchaser || officeRaiser || ownDeptKeys.length > 0;

  if (!canRaise) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Requisitions</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to raise department requisitions. Ask an admin for a production-head or purchaser role.</p>
      </div>
    );
  }

  // The requestor's own department — fixed on the form (production head → their
  // line; everyone else → Office). Not selectable.
  const reqDeptKey = requestorDeptKey((role) => has(role as WorkflowRoleKey));
  const reqDept = { key: reqDeptKey, label: requisitionDeptLabel(reqDeptKey) };
  // Purchaser, Technical Head, Logistics (and admins) may pick any of the 5
  // departments (incl. Office); the Plant Manager and Warehouseman pick the 4
  // production departments (never Office).
  const plantMgrDepts = admin || purchaser || has("technical_head") || has("logistics")
    ? REQUISITION_DEPTS.map((d) => ({ key: d.key, label: d.label }))
    : has("plant_manager") || has("warehouse")
    ? PRODUCTION_DEPTS.map((d) => ({ key: d.key, label: d.label }))
    : undefined;
  const [products, suppliers, paymentTerms, stockItems, allUsers] = await Promise.all([
    getProducts().catch(() => []),
    getSuppliers().catch(() => []),
    getPaymentTerms().catch(() => []),
    listStockItemsWithAvailability(),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const userName = new Map(allUsers.map((u) => [u.id, u.name] as const));
  const namesForRole = (role: WorkflowRoleKey): string[] =>
    usersWithWorkflowRole(assignments, role).map((uid) => userName.get(uid)).filter((n): n is string => !!n);
  // Real role check so the voucher reconciliation (and its AI receipt reader) is
  // usable here by the Purchaser / Accounting / Approver — the rest of the chain
  // stays read-only (processed in Purchasing).
  const canAct = (role: WorkflowRoleKey): boolean => admin || has(role);
  // PO money amounts and supplier name (and the View / Print PO buttons, which
  // reveal both) show only to the finance roles — Purchaser, Accounting, Payment
  // Approver, Engineers and admins. Non-finance requestors (Plant Manager,
  // production heads, Warehouse, Logistics, Sales) see the requisition status
  // but not the PO's supplier / peso figures, matching the Orders & Purchasing
  // pages.
  const showAmounts = canViewOrderAmounts(viewer, assignments);
  const showSupplier = canViewSupplier(viewer, assignments);

  // The viewer's requisitions (their departments; purchaser/admin see all active).
  let rows: (ReturnType<typeof buildPurchaseChainRow> & { createdAt: string; requestor: string })[] = [];
  let tableMissing = false;
  try {
    // Admin/purchaser see all; dept heads see their dept; everyone else
    // (Office-type raisers) sees what they raised.
    const own: Prisma.PurchaseRequestWhereInput =
      ownDeptKeys.length > 0 ? { dept: { in: ownDeptKeys } } : { createdById: viewer!.id };
    // The Plant Manager approves EVERY department requisition, but heads no
    // department — so the rule above showed them only what they raised
    // themselves, and a requisition telling its requestor "Awaiting Plant
    // Manager approval" was invisible on the very page it was raised from.
    // Give them the ones waiting on them, and the ones they have already
    // decided so an approval doesn't make the row vanish.
    const scope: Prisma.PurchaseRequestWhereInput = has("plant_manager")
      ? { OR: [own, { status: "PENDING_APPROVAL" }, { decidedById: viewer!.id }] }
      : own;
    const prs = await prisma.purchaseRequest.findMany({
      where: { kind: "department", ...(admin || purchaser ? {} : scope) },
      orderBy: { createdAt: "desc" },
    });
    rows = prs.map((pr) => ({
      ...buildPurchaseChainRow(pr, { mrfNo: null, canManagePO: false, namesForRole, canAct, admin }),
      createdAt: pr.createdAt.toISOString(),
      requestor: pr.createdByName,
    }));
  } catch {
    tableMissing = true;
  }

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div>
        <h1 className="text-2xl font-bold">Requisitions</h1>
        <p className="text-sm text-muted-foreground">Department requests for production supplies, consumables and equipment. The purchaser processes them in Purchasing; received items go into stock.</p>
      </div>

      <RequisitionForm fixedDept={reqDept} selectableDepts={plantMgrDepts} products={products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }))} />

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">My requisitions</h2>
        {tableMissing ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Purchasing isn&apos;t set up yet.</CardContent></Card>
        ) : rows.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No requisitions yet.</CardContent></Card>
        ) : (
          <RequisitionsList
            rows={rows}
            stockItems={stockItems}
            suppliers={suppliers}
            paymentTerms={paymentTerms}
            poDefaultRemarks={COMPANY.poDefaultRemarks}
            admin={admin}
            showAmounts={showAmounts}
            showSupplier={showSupplier}
            canCheckStock={admin || has("warehouse") || has("purchaser") || has("payment_approver")}
            canIssueStock={admin || has("warehouse")}
          />
        )}
      </div>
    </div>
  );
}
