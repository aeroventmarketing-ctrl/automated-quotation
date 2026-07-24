import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { purchaseStepsFrom, isPoApproved, effectiveStepRole, isDeptRequisition, PR_STATUS_LABEL, isCancellable, type PRStatus } from "@/lib/purchasing";
import { readOrderWorkflow, deptLabel, PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { buildPurchaseChainRow, buildPurchaseTrail, buildReturnViews, buildReconcileView } from "@/lib/purchase-chain-row";
import { canRaiseReturnAt, hasUnresolvedReturn, coercePurchaseReturns } from "@/lib/purchase-returns";
import { canReconcileAt } from "@/lib/purchase-reconcile";
import { coercePurchaseOrder, poLineFromPRItem } from "@/lib/purchase-order";
import { poBatchId } from "@/lib/purchase-batch";
import { getProducts } from "@/lib/product-catalog";
import { getSuppliers } from "@/lib/suppliers";
import { getPaymentTerms } from "@/lib/payment-terms";
import { COMPANY } from "@/lib/config";
import { ReplenishmentList, type PRRow } from "./replenishment-list";
import { PurchasingWorkspace } from "./purchasing-workspace";
import { PurchasingChain } from "../orders/[id]/purchasing-chain";
import { type CombinableItem, type BatchCard, type SupplierSuggestion } from "./combined-purchasing";

export const dynamic = "force-dynamic";

const CHAIN_ROLES: WorkflowRoleKey[] = ["payment_approver", "accounting", "logistics", "purchaser", "warehouse", "plant_manager"];
const variantFor = (s: PRStatus): "secondary" | "warning" | "success" | "destructive" =>
  s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";

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

  const canManagePO = admin || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "purchaser" as WorkflowRoleKey));
  const canAct = (role: WorkflowRoleKey) => admin || (viewer != null && userHasWorkflowRole(assignments, viewer.id, role));
  // Who may cancel: before approval the requestor / purchaser / admin; once
  // approved (or further) only an admin. Never once received into stock.
  const canCancelPr = (pr: { status: string; createdById: string }): boolean => {
    const status = pr.status as PRStatus;
    if (!isCancellable(status)) return false;
    if (status !== "PENDING_APPROVAL") return admin; // approved phase → admin only
    const isRequestor = viewer != null && pr.createdById === viewer.id;
    return admin || canManagePO || isRequestor;
  };
  // Delete: admin only.
  const canDeleteStatus = (_status: string): boolean => admin;

  const [stockItems, suppliers, paymentTerms, allUsers] = await Promise.all([
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }).catch(() => []),
    getSuppliers().catch(() => []),
    getPaymentTerms().catch(() => []),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const userName = new Map(allUsers.map((u) => [u.id, u.name] as const));
  const namesForRole = (role: WorkflowRoleKey): string[] =>
    usersWithWorkflowRole(assignments, role).map((uid) => userName.get(uid)).filter((n): n is string => !!n);

  let orderGroups: { id: string; title: string; subtitle: string; rows: ReturnType<typeof buildPurchaseChainRow>[] }[] = [];
  let combinable: CombinableItem[] = [];
  let batches: BatchCard[] = [];
  let suggestions: SupplierSuggestion[] = [];
  let deptRows: ReturnType<typeof buildPurchaseChainRow>[] = [];
  let tableMissing = false;

  // Product catalogue → supplier lookup, used to suggest same-supplier combines.
  const products = await getProducts().catch(() => []);
  const scanProducts = products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }));
  const suppliersByProduct = new Map<string, string[]>();
  for (const p of products) suppliersByProduct.set(p.name.trim().toLowerCase(), p.suppliers.map((s) => s.company).filter(Boolean));
  const productNamesByLen = [...suppliersByProduct.keys()].sort((a, b) => b.length - a.length);
  const suppliersForItem = (itemStr: string): string[] => {
    const desc = poLineFromPRItem(itemStr).description.trim().toLowerCase();
    if (!desc) return [];
    const exact = suppliersByProduct.get(desc);
    if (exact) return exact;
    const hit = productNamesByLen.find((n) => n.length >= 3 && (desc.includes(n) || n.includes(desc)));
    return hit ? suppliersByProduct.get(hit) ?? [] : [];
  };
  // Catalogue prices: product name → supplier company → unit price. Used to
  // pre-fill PO line prices for the purchaser's reference.
  const catalogPrices: Record<string, Record<string, number>> = {};
  for (const p of products) {
    const m: Record<string, number> = {};
    for (const s of p.suppliers) if (s.price && s.price > 0) m[s.company.toLowerCase()] = s.price;
    if (Object.keys(m).length) catalogPrices[p.name.trim().toLowerCase()] = m;
  }

  try {
    const [orderPrs, deptPrs] = await Promise.all([
      prisma.purchaseRequest.findMany({
        where: { quotationId: { not: null } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.purchaseRequest.findMany({
        where: { kind: "department", status: { notIn: ["COMPLETED"] } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    // Department requisitions share the same combine-by-supplier workspace as
    // order material requests.
    const allPrs = [...orderPrs, ...deptPrs];
    const quotationIds = [...new Set(orderPrs.map((p) => p.quotationId).filter((q): q is string => !!q))];
    const quotations = quotationIds.length
      ? await prisma.quotation.findMany({ where: { id: { in: quotationIds } }, include: { inquiry: { include: { customer: true } } } })
      : [];
    const quoteById = new Map(quotations.map((q) => [q.id, q]));
    const mrfMapByQuote = new Map<string, Map<string, string>>();
    for (const q of quotations) {
      const wf = readOrderWorkflow(q.classification);
      mrfMapByQuote.set(q.id, new Map(wf.materialRequests.map((m) => [m.id, m.formNo])));
    }
    const orderLabelOf = (qid: string | null) => {
      const q = qid ? quoteById.get(qid) : undefined;
      return q ? `${q.inquiry.customer.company} · ${q.quoteNumber}` : "—";
    };
    const mrfNoOf = (qid: string | null, mrfId: string | null) =>
      qid && mrfId ? mrfMapByQuote.get(qid)?.get(mrfId) ?? null : null;
    const deptLabelOf = (dept: string | null) =>
      dept && PRODUCTION_DEPTS.some((d) => d.key === dept) ? deptLabel(dept as (typeof PRODUCTION_DEPTS)[number]["key"]) : dept ?? "—";

    const batched = allPrs.filter((pr) => poBatchId(pr.po));
    const unbatched = allPrs.filter((pr) => !poBatchId(pr.po));

    // Combinable: pending approval, no PO yet — but NOT material/department
    // requisitions, which the Plant Manager must approve (step 16) before any PO
    // is prepared (step 17).
    combinable = unbatched
      .filter((pr) => pr.status === "PENDING_APPROVAL" && !coercePurchaseOrder(pr.po) && !isDeptRequisition(pr))
      .map((pr) => {
        const items = Array.isArray(pr.items) ? (pr.items as string[]) : [];
        // Candidate suppliers = union of the suppliers that stock this request's items.
        const supplierCompanies = [...new Set(items.flatMap((it) => suppliersForItem(it)))];
        return {
          id: pr.id,
          orderId: pr.quotationId ?? "",
          orderLabel: pr.quotationId ? orderLabelOf(pr.quotationId) : `Department · ${deptLabelOf(pr.dept)}`,
          deptLabel: deptLabelOf(pr.dept),
          mrfNo: mrfNoOf(pr.quotationId, pr.mrfId),
          items,
          supplierCompanies,
          canDelete: canDeleteStatus(pr.status),
        };
      });

    // Suggest combines: any supplier that can serve 2+ of the combinable requests.
    const byCompany = new Map<string, { company: string; prIds: string[] }>();
    for (const c of combinable) {
      for (const company of c.supplierCompanies) {
        const key = company.toLowerCase();
        const entry = byCompany.get(key) ?? { company, prIds: [] };
        entry.prIds.push(c.id);
        byCompany.set(key, entry);
      }
    }
    suggestions = [...byCompany.values()]
      .filter((e) => e.prIds.length >= 2)
      .sort((a, b) => b.prIds.length - a.prIds.length);

    // Combined POs: group members by batch id.
    const byBatch = new Map<string, typeof batched>();
    for (const pr of batched) {
      const bid = poBatchId(pr.po)!;
      const arr = byBatch.get(bid) ?? [];
      arr.push(pr);
      byBatch.set(bid, arr);
    }
    batches = [...byBatch.values()].map((members) => {
      const anchor = members[0];
      const po = coercePurchaseOrder(anchor.po);
      const status = anchor.status as PRStatus;
      const trail = buildPurchaseTrail(anchor);
      const bIsDept = isDeptRequisition(anchor);
      const actions = purchaseStepsFrom(status, bIsDept, isPoApproved(anchor.chainLog)).map((step) => {
        const role = effectiveStepRole(step, bIsDept);
        const names = namesForRole(role);
        return { key: step.key, label: step.label, canAct: canAct(role), roleLabel: `${workflowRoleLabel(role)}${names.length ? ` (${names.join(", ")})` : ""}` };
      });
      const bRequestor = viewer != null && members.some((m) => m.createdById === viewer.id);
      const canCancel = isCancellable(status) && (status !== "PENDING_APPROVAL" ? admin : admin || canManagePO || bRequestor);
      const canDelete = canDeleteStatus(status);
      // Supplier returns ride on the anchor request (the whole PO).
      const returns = buildReturnViews(anchor);
      const canRaiseReturn = canRaiseReturnAt(status) && (canAct("purchaser") || canAct("warehouse") || canAct("plant_manager"));
      const canResolveReturn = canAct("purchaser") || canAct("warehouse");
      // Voucher reconciliation rides on the anchor (the whole PO / voucher).
      const reconcile = buildReconcileView(anchor);
      const canRecordReconcile = canReconcileAt(status) && (canAct("purchaser") || canAct("accounting") || canAct("payment_approver"));
      const canSettleReconcile = canAct("accounting") || canAct("purchaser");
      const canEscalateReconcile = canAct("accounting") || canAct("purchaser");
      const canApproveReconcile = canAct("payment_approver");
      return {
        anchorId: anchor.id,
        orderIdForPrint: anchor.quotationId ?? "",
        poNumber: po?.poNumber ?? "—",
        supplierCompany: po?.supplier.company ?? "",
        supplierAttention: po?.supplier.attention ?? "",
        supplierAddress: po?.supplier.address ?? "",
        ewtPct: po?.ewtPct ?? 0,
        ewtMode: po?.ewtMode ?? "percent",
        ewtAmount: po?.ewtAmount ?? 0,
        remarks: po?.remarks ?? "",
        status,
        statusLabel: PR_STATUS_LABEL[status],
        variant: variantFor(status),
        lines: po?.lines ?? [],
        members: members.map((m) => ({
          orderLabel: m.quotationId ? orderLabelOf(m.quotationId) : `Department · ${deptLabelOf(m.dept)}`,
          deptLabel: deptLabelOf(m.dept),
          mrfNo: mrfNoOf(m.quotationId, m.mrfId),
          items: Array.isArray(m.items) ? (m.items as string[]) : [],
        })),
        trail,
        actions,
        canManagePO,
        canCancel,
        canDelete,
        returns,
        canRaiseReturn,
        canResolveReturn,
        reconcile,
        canRecordReconcile,
        canSettleReconcile,
        canEscalateReconcile,
        canApproveReconcile,
      } satisfies BatchCard;
    });

    // Per-order individual chains — only unbatched requests.
    orderGroups = quotationIds
      .map((qid) => {
        const q = quoteById.get(qid);
        if (!q) return null;
        const rows = unbatched
          .filter((pr) => pr.quotationId === qid)
          .map((pr) =>
            buildPurchaseChainRow(pr, { mrfNo: mrfNoOf(qid, pr.mrfId), canManagePO, canCancel: canCancelPr(pr), canDelete: canDeleteStatus(pr.status), namesForRole, canAct, admin }),
          );
        if (rows.length === 0) return null;
        const project = q.projectName ?? q.inquiry.projectName ?? "";
        return { id: q.id, title: q.inquiry.customer.company, subtitle: `Order ${q.quoteNumber}${project ? ` · ${project}` : ""}`, rows };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);

    // Uncombined department requisitions → individual chains. Completed ones are
    // excluded above, except those still carrying an open supplier return so the
    // replacement can be tracked and resolved after the good items were received.
    const completedDeptWithReturns = (
      await prisma.purchaseRequest.findMany({ where: { kind: "department", status: "COMPLETED" }, orderBy: { createdAt: "desc" } })
    ).filter((pr) => hasUnresolvedReturn(coercePurchaseReturns(pr.returns)));
    deptRows = [...unbatched.filter((pr) => pr.kind === "department"), ...completedDeptWithReturns].map((pr) =>
      buildPurchaseChainRow(pr, {
        mrfNo: null,
        canManagePO,
        canCancel: canCancelPr(pr),
        canDelete: canDeleteStatus(pr.status),
        namesForRole,
        canAct,
        admin,
      }),
    );
  } catch {
    tableMissing = true;
  }

  // Replenishment (stock top-ups).
  let replenRows: PRRow[] = [];
  if (!tableMissing) {
    try {
      const prs = await prisma.purchaseRequest.findMany({
        where: { kind: "replenishment", status: { notIn: ["COMPLETED", "REJECTED"] } },
        orderBy: { createdAt: "asc" },
      });
      const stockIds = [...new Set(prs.map((p) => p.stockItemId).filter((s): s is string => !!s))];
      const stock = stockIds.length ? await prisma.stockItem.findMany({ where: { id: { in: stockIds } }, select: { id: true, sku: true, unit: true } }) : [];
      const stockById = new Map(stock.map((s) => [s.id, s]));
      replenRows = prs.map((pr) => {
        const status = pr.status as PRStatus;
        const trail = buildPurchaseTrail(pr);
        const actions = purchaseStepsFrom(status).map((step) => ({ key: step.key, label: step.label, roleLabel: workflowRoleLabel(step.role), canAct: canAct(step.role) }));
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
          variant: variantFor(status),
          trail,
          actions,
        };
      });
    } catch {
      tableMissing = true;
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Purchasing</h1>
        <p className="text-sm text-muted-foreground">
          One workspace for every material request. Combine requests to the same supplier into a single PO, then approve, purchase, check and receive — across all orders.
        </p>
      </div>

      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Run migration 0012 in Supabase to enable purchasing.</CardContent></Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Order material requests</h2>
            <PurchasingWorkspace
              batches={batches}
              combinable={combinable}
              suggestions={suggestions}
              orderGroups={orderGroups}
              suppliers={suppliers}
              paymentTerms={paymentTerms}
              stockItems={stockItems}
              canManagePO={canManagePO}
              poDefaultRemarks={COMPANY.poDefaultRemarks}
              catalogPrices={catalogPrices}
              catalogSuppliers={Object.fromEntries(suppliersByProduct)}
              scanProducts={scanProducts}
              admin={admin}
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Department requisitions</h2>
            {deptRows.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No open department requisitions. Departments raise them from Requisitions.</CardContent></Card>
            ) : (
              <Card>
                <CardContent className="pt-6">
                  <PurchasingChain
                    requests={deptRows}
                    stockItems={stockItems}
                    orderId=""
                    poDefaultRemarks={COMPANY.poDefaultRemarks}
                    suppliers={suppliers}
                    paymentTerms={paymentTerms}
                    canManagePO={canManagePO}
                    admin={admin}
                    catalogSuppliers={Object.fromEntries(suppliersByProduct)}
                    catalogPrices={catalogPrices}
                    scanProducts={scanProducts}
                    poRoute="purchasing"
                  />
                </CardContent>
              </Card>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Replenishment (stock top-ups)</h2>
            {replenRows.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No open replenishment requests. Raise them from Inventory → Reorder.</CardContent></Card>
            ) : (
              <ReplenishmentList rows={replenRows} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
