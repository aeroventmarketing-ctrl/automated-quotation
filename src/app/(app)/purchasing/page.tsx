import { prisma } from "@/lib/db";
import { listStockItemsWithAvailability } from "@/lib/inventory";
import { AutoRefresh } from "@/components/auto-refresh";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { canViewOrderAmounts, canViewSupplier } from "@/lib/price-visibility";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { purchaseStepsFrom, isPoApproved, effectiveStepRole, isDeptRequisition, PR_STATUS_LABEL, isCancellable, type PRStatus } from "@/lib/purchasing";
import { readOrderWorkflow, requisitionDeptLabel, REQUISITION_DEPTS } from "@/lib/order-workflow";
import { buildPurchaseChainRow, buildPurchaseTrail, buildReturnViews, buildReconcileView } from "@/lib/purchase-chain-row";
import { getVoucherNoByPr } from "@/lib/purchase-voucher";
import { canRaiseReturnAt, hasUnresolvedReturn, coercePurchaseReturns } from "@/lib/purchase-returns";
import { canReconcileAt } from "@/lib/purchase-reconcile";
import { coercePurchaseOrder, poLineFromPRItem, isIssuedFromStockLine, stripToPurchasePrefix, withSpecDetail } from "@/lib/purchase-order";
import { orderBoughtInLines } from "@/lib/department-pnl";
import { poBatchId } from "@/lib/purchase-batch";
import { getProducts } from "@/lib/product-catalog";
import { REF_PRICE_KEY } from "@/lib/po-catalog";
import { getSuppliers } from "@/lib/suppliers";
import { coerceCheckDocs, canAttachCheck } from "@/lib/voucher-check";
import { getPaymentTerms } from "@/lib/payment-terms";
import { COMPANY } from "@/lib/config";
import { type ReplenScanRow } from "./replenishment-list";
import { PurchasingWorkspace } from "./purchasing-workspace";
import { type CombinableItem, type BatchCard, type SupplierSuggestion } from "./combined-purchasing";

export const dynamic = "force-dynamic";

const CHAIN_ROLES: WorkflowRoleKey[] = ["payment_approver", "accounting", "logistics", "purchaser", "warehouse", "plant_manager"];
const variantFor = (s: PRStatus): "secondary" | "warning" | "success" | "destructive" =>
  s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";

export default async function PurchasingPage({ searchParams }: { searchParams?: Promise<{ req?: string }> }) {
  const highlightReq = (await searchParams)?.req;
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
  // PO money amounts show only to money-handling roles (Purchaser, Accounting,
  // Payment Approver) + admins; hidden from Warehouse / Logistics / Plant Manager.
  const showAmounts = canViewOrderAmounts(viewer, assignments);
  const showSupplier = canViewSupplier(viewer, assignments);
  const canAct = (role: WorkflowRoleKey) => admin || (viewer != null && userHasWorkflowRole(assignments, viewer.id, role));
  // Generating a payment voucher from selected requests — Accounting, Payment
  // Approver or an admin.
  const canVoucher = canAct("accounting") || canAct("payment_approver");
  // Attaching the photo of the check issued for a PO — Accounting, the Payment
  // Approver, an admin. Same audience as the voucher itself.
  const canAttachCheckHere = canAttachCheck({
    admin,
    workflowRoles: (["accounting", "payment_approver"] as WorkflowRoleKey[]).filter((r) => viewer != null && userHasWorkflowRole(assignments, viewer.id, r)),
  });
  // Printed cash-voucher number covering each purchase request (if any).
  const voucherNoByPr = await getVoucherNoByPr().catch(() => new Map<string, string>());
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
    listStockItemsWithAvailability(),
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
  let completedDeptRows: ReturnType<typeof buildPurchaseChainRow>[] = [];
  let tableMissing = false;

  // Which supplier companies give us payment terms — i.e. we pay them later, by
  // check, so a PO to them is expected to carry a photo of that check. The flag
  // lives on the supplier record, deliberately not read out of the PO's free-text
  // payment-terms remark (see the note on `Supplier.terms`).
  const termsCompanies = new Set(suppliers.filter((s) => s.terms).map((s) => s.company.trim().toLowerCase()));
  const givesTerms = (company: string | undefined): boolean => !!company && termsCompanies.has(company.trim().toLowerCase());

  // Product catalogue → supplier lookup, used to suggest same-supplier combines.
  const products = await getProducts().catch(() => []);
  const scanProducts = products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }));
  const suppliersByProduct = new Map<string, string[]>();
  for (const p of products) suppliersByProduct.set(p.name.trim().toLowerCase(), p.suppliers.map((s) => s.company).filter(Boolean));
  const productNamesByLen = [...suppliersByProduct.keys()].sort((a, b) => b.length - a.length);
  const suppliersForItem = (itemStr: string): string[] => {
    if (isIssuedFromStockLine(itemStr)) return []; // issued-from-stock record, not purchased
    const desc = poLineFromPRItem(stripToPurchasePrefix(itemStr)).description.trim().toLowerCase();
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
  // Reference price per item, keyed under REF_PRICE_KEY: the LOWEST supplier
  // price (products' "Lowest price"), else the stock item's unit cost
  // (inventory's "Unit cost"). Autofills a PO line's unit price when the chosen
  // supplier has no saved price of its own.
  const stockCosts = await prisma.stockItem
    .findMany({ where: { active: true }, select: { name: true, unitCost: true } })
    .catch(() => [] as { name: string; unitCost: unknown }[]);
  const costByName = new Map<string, number>();
  for (const si of stockCosts) {
    const n = si.name.trim().toLowerCase();
    const c = Number(si.unitCost);
    if (c > 0 && !costByName.has(n)) costByName.set(n, c);
  }
  for (const p of products) {
    const key = p.name.trim().toLowerCase();
    const m = catalogPrices[key] ?? {};
    const supplierPrices = Object.values(m).filter((n) => n > 0);
    const ref = supplierPrices.length ? Math.min(...supplierPrices) : costByName.get(key) ?? 0;
    if (ref > 0) {
      m[REF_PRICE_KEY] = ref;
      catalogPrices[key] = m;
    }
  }
  // Inventory-only items (stocked but not in the product catalogue) still offer
  // their unit cost as the reference price.
  for (const [n, c] of costByName) if (!catalogPrices[n]) catalogPrices[n] = { [REF_PRICE_KEY]: c };

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
    const quotationIds = [...new Set(orderPrs.map((p) => p.quotationId).filter((q): q is string => !!q))];
    const quotations = quotationIds.length
      ? await prisma.quotation.findMany({
          where: { id: { in: quotationIds } },
          include: { inquiry: { include: { customer: true } }, items: true },
        })
      : [];
    const quoteById = new Map(quotations.map((q) => [q.id, q]));
    // The quotation's specification per order, so a requisition raised before the
    // generator carried it still reads — and prints on its PO — the way the
    // quotation does.
    const specsByQuote = new Map(
      quotations.map((q) => [q.id, orderBoughtInLines(q.items).map((b) => ({ name: b.name, detail: b.detail }))]),
    );

    // Department requisitions share the same combine-by-supplier workspace as
    // order material requests. A bought-in supplier requisition is BOTH a
    // department requisition AND order-linked (has a quotationId), so it matches
    // both queries — dedupe by id so it renders once, not twice.
    const allPrs = [...new Map([...orderPrs, ...deptPrs].map((pr) => [pr.id, pr])).values()].map((pr) => {
      const specs = pr.quotationId ? specsByQuote.get(pr.quotationId) ?? [] : [];
      if (specs.length === 0) return pr;
      const items = Array.isArray(pr.items) ? (pr.items as string[]) : [];
      const enriched = withSpecDetail(items, specs);
      // Enrich once here so everything downstream — the cards, the combine
      // picker and the PO's default lines — sees the same full description.
      return enriched.some((l, i) => l !== items[i]) ? { ...pr, items: enriched as unknown as typeof pr.items } : pr;
    });
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
    const deptLabelOf = (dept: string | null) => requisitionDeptLabel(dept);

    const batched = allPrs.filter((pr) => poBatchId(pr.po));
    const unbatched = allPrs.filter((pr) => !poBatchId(pr.po));

    // Combinable: approved, no PO yet — the PO is prepared after approval now, so
    // several approved requests to the same supplier can share one PO. Material/
    // department requisitions are excluded (they run their own approval chain).
    combinable = unbatched
      .filter((pr) => pr.status === "APPROVED" && !coercePurchaseOrder(pr.po) && !isDeptRequisition(pr))
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
      const returnAdvanceRoles = (["purchaser", "logistics", "warehouse", "plant_manager"] as WorkflowRoleKey[]).filter((r) => canAct(r));
      // Voucher reconciliation rides on the anchor (the whole PO / voucher).
      const reconcile = buildReconcileView(anchor);
      const canRecordReconcile = canReconcileAt(status) && (canAct("purchaser") || canAct("accounting") || canAct("payment_approver"));
      const canSettleReconcile = canAct("accounting") || canAct("purchaser");
      const canEscalateReconcile = canAct("accounting") || canAct("purchaser");
      const canApproveReconcile = canAct("payment_approver");
      return {
        checkDocs: coerceCheckDocs(anchor.voucherCheckDocs),
        supplierGivesTerms: givesTerms(po?.supplier.company),
        canAttachCheck: canAttachCheckHere,
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
        poApproved: isPoApproved(anchor.chainLog),
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
        returnAdvanceRoles,
        returnAdmin: admin,
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
            buildPurchaseChainRow(pr, { mrfNo: mrfNoOf(qid, pr.mrfId), canManagePO, canCancel: canCancelPr(pr), canDelete: canDeleteStatus(pr.status), namesForRole, canAct, admin, voucherNo: voucherNoByPr.get(pr.id) ?? null, canAttachCheck: canAttachCheckHere, givesTerms }),
          );
        if (rows.length === 0) return null;
        const project = q.projectName ?? q.inquiry.projectName ?? "";
        return { id: q.id, title: q.inquiry.customer.company, subtitle: `Order ${q.quoteNumber}${project ? ` · ${project}` : ""}`, rows };
      })
      .filter((g): g is NonNullable<typeof g> => g !== null);

    // Uncombined department requisitions → individual chains. Completed ones are
    // excluded from the active list above; a completed one still carrying an open
    // supplier return stays active (so the replacement can be tracked/resolved),
    // while the rest move to the collapsed "Completed" section below — so a finished
    // PO stays viewable/printable instead of vanishing from the tab.
    const completedDept = (
      await prisma.purchaseRequest.findMany({ where: { kind: "department", status: "COMPLETED" }, orderBy: { createdAt: "desc" } })
    ).filter((pr) => !pr.quotationId);
    const hasOpenReturn = (pr: (typeof completedDept)[number]) => hasUnresolvedReturn(coercePurchaseReturns(pr.returns));
    const deptRowCtx = (pr: { id: string; status: string; createdById: string }) => ({
      mrfNo: null,
      canManagePO,
      canCancel: canCancelPr(pr),
      canDelete: canDeleteStatus(pr.status),
      namesForRole,
      canAct,
      admin,
      voucherNo: voucherNoByPr.get(pr.id) ?? null,
      canAttachCheck: canAttachCheckHere,
      givesTerms,
    });
    // Order-linked (bought-in supplier) requisitions carry a quotationId and are
    // shown under their order above — keep them out of the generic Department
    // requisitions section so they render exactly once.
    deptRows = [...unbatched.filter((pr) => pr.kind === "department"), ...completedDept.filter(hasOpenReturn)]
      .filter((pr) => !pr.quotationId)
      .map((pr) => buildPurchaseChainRow(pr, deptRowCtx(pr)));
    // Completed standalone department POs with no open return — the collapsed
    // "Completed" section (view / print / reconcile only; the chain is terminal).
    completedDeptRows = completedDept
      .filter((pr) => !hasOpenReturn(pr))
      .map((pr) => buildPurchaseChainRow(pr, deptRowCtx(pr)));
  } catch {
    tableMissing = true;
  }

  // Replenishment (stock top-ups). These now follow the SAME purchasing chain as
  // department requisitions (approve → Create PO → voucher → … → receive), so they
  // render through PurchasingChain. A parallel `replenScan` list feeds the
  // scan-to-receive quick box for those that have reached the receive step.
  let replenRows: ReturnType<typeof buildPurchaseChainRow>[] = [];
  let replenScan: ReplenScanRow[] = [];
  if (!tableMissing) {
    try {
      // All statuses — the workspace tab (Pending/Approved/Rejected/Cancelled)
      // decides which ones show, same as the order + department requests.
      const prs = await prisma.purchaseRequest.findMany({
        where: { kind: "replenishment" },
        orderBy: { createdAt: "asc" },
      });
      const stockIds = [...new Set(prs.map((p) => p.stockItemId).filter((s): s is string => !!s))];
      const stock = stockIds.length ? await prisma.stockItem.findMany({ where: { id: { in: stockIds } }, select: { id: true, sku: true, unit: true } }) : [];
      const stockById = new Map(stock.map((s) => [s.id, s]));
      replenRows = prs.map((pr) =>
        buildPurchaseChainRow(pr, { mrfNo: null, canManagePO, canCancel: canCancelPr(pr), canDelete: canDeleteStatus(pr.status), namesForRole, canAct, admin, voucherNo: voucherNoByPr.get(pr.id) ?? null, canAttachCheck: canAttachCheckHere, givesTerms }),
      );
      // Ready to receive = the receive step is available (PLANT_APPROVED) and the
      // viewer is the Warehouse/admin who can post it into stock.
      replenScan = prs
        .filter((pr) => pr.status === "PLANT_APPROVED" && (admin || canAct("warehouse")))
        .map((pr) => {
          const si = pr.stockItemId ? stockById.get(pr.stockItemId) : undefined;
          return { id: pr.id, stockItemId: pr.stockItemId ?? "", sku: si?.sku ?? null, unit: si?.unit ?? "", items: Array.isArray(pr.items) ? (pr.items as string[]) : [] };
        });
    } catch {
      tableMissing = true;
    }
  }

  return (
    <div className="space-y-6">
      <AutoRefresh />
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
              deptRows={deptRows}
              completedDeptRows={completedDeptRows}
              replenRows={replenRows}
              replenScan={replenScan}
              highlightReq={highlightReq}
              showAmounts={showAmounts}
              showSupplier={showSupplier}
              canVoucher={canVoucher}
              canCheckStock={admin || canAct("warehouse") || canAct("purchaser") || canAct("payment_approver")}
              canIssueStock={admin || canAct("warehouse")}
              depts={REQUISITION_DEPTS.map((d) => ({ key: d.key, label: d.label }))}
            />
          </section>
        </>
      )}
    </div>
  );
}
