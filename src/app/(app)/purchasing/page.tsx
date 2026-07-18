import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { purchaseStepsFrom, PR_STATUS_LABEL, type PRStatus } from "@/lib/purchasing";
import { readOrderWorkflow, deptLabel, PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { buildPurchaseChainRow } from "@/lib/purchase-chain-row";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { poBatchId } from "@/lib/purchase-batch";
import { getSuppliers } from "@/lib/suppliers";
import { getPaymentTerms } from "@/lib/payment-terms";
import { COMPANY } from "@/lib/config";
import { ReplenishmentList, type PRRow } from "./replenishment-list";
import { PurchasingChain } from "../orders/[id]/purchasing-chain";
import { CombinedPurchasing, type CombinableItem, type BatchCard } from "./combined-purchasing";

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

  const [stockItems, suppliers, paymentTerms, allUsers] = await Promise.all([
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }).catch(() => []),
    getSuppliers().catch(() => []),
    getPaymentTerms().catch(() => []),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const userName = new Map(allUsers.map((u) => [u.id, u.name] as const));
  const namesForRole = (role: WorkflowRoleKey): string[] =>
    usersWithWorkflowRole(assignments, role).map((uid) => userName.get(uid)).filter((n): n is string => !!n);
  const stamp = (label: string, who?: string | null, at?: Date | null) =>
    who ? `${label} — ${who} · ${formatDateTime(at ?? undefined)}` : null;

  let orderGroups: { id: string; title: string; subtitle: string; rows: ReturnType<typeof buildPurchaseChainRow>[] }[] = [];
  let combinable: CombinableItem[] = [];
  let batches: BatchCard[] = [];
  let tableMissing = false;
  try {
    const orderPrs = await prisma.purchaseRequest.findMany({
      where: { quotationId: { not: null }, status: { notIn: ["COMPLETED", "REJECTED"] } },
      orderBy: { createdAt: "asc" },
    });
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

    const batched = orderPrs.filter((pr) => poBatchId(pr.po));
    const unbatched = orderPrs.filter((pr) => !poBatchId(pr.po));

    // Combinable: pending approval, no PO yet.
    combinable = unbatched
      .filter((pr) => pr.status === "PENDING_APPROVAL" && !coercePurchaseOrder(pr.po))
      .map((pr) => ({
        id: pr.id,
        orderId: pr.quotationId ?? "",
        orderLabel: orderLabelOf(pr.quotationId),
        deptLabel: deptLabelOf(pr.dept),
        mrfNo: mrfNoOf(pr.quotationId, pr.mrfId),
        items: Array.isArray(pr.items) ? (pr.items as string[]) : [],
      }));

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
      const trail = [
        stamp("Requested", anchor.createdByName, anchor.createdAt),
        stamp(status === "REJECTED" ? "Rejected" : "Approved", anchor.decidedByName, anchor.decidedAt),
        stamp("Voucher & check", anchor.voucherByName, anchor.voucherAt),
        stamp("Purchased", anchor.purchasedByName, anchor.purchasedAt),
        stamp("Checked", anchor.checkedByName, anchor.checkedAt),
        stamp("Received", anchor.receivedByName, anchor.receivedAt),
        stamp("Plant Manager approved", anchor.plantApprovedByName, anchor.plantApprovedAt),
      ].filter((s): s is string => s !== null);
      const actions = purchaseStepsFrom(status).map((step) => {
        const names = namesForRole(step.role);
        return { key: step.key, label: step.label, canAct: canAct(step.role), roleLabel: `${workflowRoleLabel(step.role)}${names.length ? ` (${names.join(", ")})` : ""}` };
      });
      return {
        anchorId: anchor.id,
        orderIdForPrint: anchor.quotationId ?? "",
        poNumber: po?.poNumber ?? "—",
        supplierCompany: po?.supplier.company ?? "",
        status,
        statusLabel: PR_STATUS_LABEL[status],
        variant: variantFor(status),
        lines: po?.lines ?? [],
        members: members.map((m) => ({
          orderLabel: orderLabelOf(m.quotationId),
          deptLabel: deptLabelOf(m.dept),
          mrfNo: mrfNoOf(m.quotationId, m.mrfId),
          items: Array.isArray(m.items) ? (m.items as string[]) : [],
        })),
        trail,
        actions,
        canManagePO,
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
            buildPurchaseChainRow(pr, { mrfNo: mrfNoOf(qid, pr.mrfId), canManagePO, namesForRole, canAct }),
          );
        if (rows.length === 0) return null;
        const project = q.projectName ?? q.inquiry.projectName ?? "";
        return { id: q.id, title: q.inquiry.customer.company, subtitle: `Order ${q.quoteNumber}${project ? ` · ${project}` : ""}`, rows };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
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
        const trail = [
          stamp("Requested", pr.createdByName, pr.createdAt),
          stamp(status === "REJECTED" ? "Rejected" : "Approved", pr.decidedByName, pr.decidedAt),
          stamp("Voucher & check", pr.voucherByName, pr.voucherAt),
          stamp("Purchased", pr.purchasedByName, pr.purchasedAt),
          stamp("Checked", pr.checkedByName, pr.checkedAt),
          stamp("Received", pr.receivedByName, pr.receivedAt),
          stamp("Plant Manager approved", pr.plantApprovedByName, pr.plantApprovedAt),
        ].filter((s): s is string => s !== null);
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

  const hasOrderWork = combinable.length > 0 || batches.length > 0 || orderGroups.length > 0;

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
            {!hasOrderWork ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No open order material requests.</CardContent></Card>
            ) : (
              <>
                {(combinable.length > 0 || batches.length > 0) && (
                  <CombinedPurchasing
                    combinable={combinable}
                    batches={batches}
                    suppliers={suppliers}
                    paymentTerms={paymentTerms}
                    stockItems={stockItems}
                    canManagePO={canManagePO}
                    poDefaultRemarks={COMPANY.poDefaultRemarks}
                  />
                )}
                {orderGroups.map((g) => (
                  <Card key={g.id}>
                    <CardContent className="space-y-3 pt-6">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <Link href={`/orders/${g.id}`} className="font-semibold hover:underline">{g.title}</Link>
                          <span className="ml-2 text-xs text-muted-foreground">{g.subtitle}</span>
                        </div>
                        <Link href={`/orders/${g.id}`} className="text-xs font-medium text-primary hover:underline">Open order →</Link>
                      </div>
                      <PurchasingChain
                        requests={g.rows}
                        stockItems={stockItems}
                        orderId={g.id}
                        poDefaultRemarks={COMPANY.poDefaultRemarks}
                        suppliers={suppliers}
                        paymentTerms={paymentTerms}
                        canManagePO={canManagePO}
                      />
                    </CardContent>
                  </Card>
                ))}
              </>
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
