import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { purchaseStepsFrom, PR_STATUS_LABEL, isCancellable, type PRStatus } from "@/lib/purchasing";
import { readOrderWorkflow, deptLabel, PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { buildPurchaseChainRow } from "@/lib/purchase-chain-row";
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
  const stamp = (label: string, who?: string | null, at?: Date | null) =>
    who ? `${label} — ${who} · ${formatDateTime(at ?? undefined)}` : null;

  let orderGroups: { id: string; title: string; subtitle: string; rows: ReturnType<typeof buildPurchaseChainRow>[] }[] = [];
  let combinable: CombinableItem[] = [];
  let batches: BatchCard[] = [];
  let suggestions: SupplierSuggestion[] = [];
  let tableMissing = false;

  // Product catalogue → supplier lookup, used to suggest same-supplier combines.
  const products = await getProducts().catch(() => []);
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
    const orderPrs = await prisma.purchaseRequest.findMany({
      where: { quotationId: { not: null } },
      orderBy: { createdAt: "desc" },
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
      .map((pr) => {
        const items = Array.isArray(pr.items) ? (pr.items as string[]) : [];
        // Candidate suppliers = union of the suppliers that stock this request's items.
        const supplierCompanies = [...new Set(items.flatMap((it) => suppliersForItem(it)))];
        return {
          id: pr.id,
          orderId: pr.quotationId ?? "",
          orderLabel: orderLabelOf(pr.quotationId),
          deptLabel: deptLabelOf(pr.dept),
          mrfNo: mrfNoOf(pr.quotationId, pr.mrfId),
          items,
          supplierCompanies,
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
      const bRequestor = viewer != null && members.some((m) => m.createdById === viewer.id);
      const canCancel = isCancellable(status) && (status !== "PENDING_APPROVAL" ? admin : admin || canManagePO || bRequestor);
      const canDelete = canDeleteStatus(status);
      return {
        anchorId: anchor.id,
        orderIdForPrint: anchor.quotationId ?? "",
        poNumber: po?.poNumber ?? "—",
        supplierCompany: po?.supplier.company ?? "",
        supplierAttention: po?.supplier.attention ?? "",
        supplierAddress: po?.supplier.address ?? "",
        ewtPct: po?.ewtPct ?? 0,
        remarks: po?.remarks ?? "",
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
        canCancel,
        canDelete,
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
            buildPurchaseChainRow(pr, { mrfNo: mrfNoOf(qid, pr.mrfId), canManagePO, canCancel: canCancelPr(pr), canDelete: canDeleteStatus(pr.status), namesForRole, canAct }),
          );
        if (rows.length === 0) return null;
        const project = q.projectName ?? q.inquiry.projectName ?? "";
        return { id: q.id, title: q.inquiry.customer.company, subtitle: `Order ${q.quoteNumber}${project ? ` · ${project}` : ""}`, rows };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);
  } catch {
    tableMissing = true;
  }

  // Department requisitions (production supplies, not tied to an order).
  let deptRows: ReturnType<typeof buildPurchaseChainRow>[] = [];
  if (!tableMissing) {
    try {
      const prs = await prisma.purchaseRequest.findMany({
        where: { kind: "department", status: { notIn: ["COMPLETED"] } },
        orderBy: { createdAt: "desc" },
      });
      deptRows = prs.map((pr) =>
        buildPurchaseChainRow(pr, {
          mrfNo: null,
          canManagePO,
          canCancel: canCancelPr(pr),
          canDelete: canDeleteStatus(pr.status),
          namesForRole,
          canAct,
        }),
      );
    } catch {
      tableMissing = true;
    }
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
                    catalogSuppliers={Object.fromEntries(suppliersByProduct)}
                    catalogPrices={catalogPrices}
                    poHref={(prId) => `/purchasing/po/${prId}/xlsx`}
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
