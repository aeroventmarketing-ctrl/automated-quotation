import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { purchaseStepsFrom, PR_STATUS_LABEL, type PRStatus } from "@/lib/purchasing";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { buildPurchaseChainRow } from "@/lib/purchase-chain-row";
import { getSuppliers } from "@/lib/suppliers";
import { getPaymentTerms } from "@/lib/payment-terms";
import { COMPANY } from "@/lib/config";
import { ReplenishmentList, type PRRow } from "./replenishment-list";
import { PurchasingChain } from "../orders/[id]/purchasing-chain";

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

  const canManagePO = admin || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "purchaser" as WorkflowRoleKey));
  const canAct = (role: WorkflowRoleKey) => admin || (viewer != null && userHasWorkflowRole(assignments, viewer.id, role));

  // Shared reference data for the order-purchasing chains.
  const [stockItems, suppliers, paymentTerms, allUsers] = await Promise.all([
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }).catch(() => []),
    getSuppliers().catch(() => []),
    getPaymentTerms().catch(() => []),
    prisma.user.findMany({ select: { id: true, name: true } }),
  ]);
  const userName = new Map(allUsers.map((u) => [u.id, u.name] as const));
  const namesForRole = (role: WorkflowRoleKey): string[] =>
    usersWithWorkflowRole(assignments, role).map((uid) => userName.get(uid)).filter((n): n is string => !!n);

  // --- Order material requests (grouped by order) --------------------------
  let orderGroups: { id: string; title: string; subtitle: string; rows: ReturnType<typeof buildPurchaseChainRow>[] }[] = [];
  let tableMissing = false;
  try {
    const orderPrs = await prisma.purchaseRequest.findMany({
      where: { quotationId: { not: null }, status: { notIn: ["COMPLETED", "REJECTED"] } },
      orderBy: { createdAt: "asc" },
    });
    const quotationIds = [...new Set(orderPrs.map((p) => p.quotationId).filter((q): q is string => !!q))];
    const quotations = quotationIds.length
      ? await prisma.quotation.findMany({
          where: { id: { in: quotationIds } },
          include: { inquiry: { include: { customer: true } } },
        })
      : [];
    const quoteById = new Map(quotations.map((q) => [q.id, q]));
    const mrfMapByQuote = new Map<string, Map<string, string>>();
    for (const q of quotations) {
      const wf = readOrderWorkflow(q.classification);
      mrfMapByQuote.set(q.id, new Map(wf.materialRequests.map((m) => [m.id, m.formNo])));
    }
    orderGroups = quotationIds
      .map((qid) => {
        const q = quoteById.get(qid);
        if (!q) return null;
        const mrfMap = mrfMapByQuote.get(qid) ?? new Map<string, string>();
        const rows = orderPrs
          .filter((pr) => pr.quotationId === qid)
          .map((pr) =>
            buildPurchaseChainRow(pr, {
              mrfNo: pr.mrfId ? mrfMap.get(pr.mrfId) ?? null : null,
              canManagePO,
              namesForRole,
              canAct,
            }),
          );
        const project = q.projectName ?? q.inquiry.projectName ?? "";
        return {
          id: q.id,
          title: q.inquiry.customer.company,
          subtitle: `Order ${q.quoteNumber}${project ? ` · ${project}` : ""}`,
          rows,
        };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  } catch {
    tableMissing = true;
  }

  // --- Replenishment requests (stock top-ups) ------------------------------
  let replenRows: PRRow[] = [];
  if (!tableMissing) {
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
        const actions = purchaseStepsFrom(status).map((step) => ({
          key: step.key,
          label: step.label,
          roleLabel: workflowRoleLabel(step.role),
          canAct: canAct(step.role),
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
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Purchasing</h1>
        <p className="text-sm text-muted-foreground">
          One workspace for every material request. Approve, issue the supplier PO, ready the voucher, purchase, check and receive — across all orders.
        </p>
      </div>

      {tableMissing ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Run migration 0012 in Supabase to enable purchasing.</CardContent></Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Order material requests</h2>
            {orderGroups.length === 0 ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No open order material requests.</CardContent></Card>
            ) : (
              orderGroups.map((g) => (
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
              ))
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
