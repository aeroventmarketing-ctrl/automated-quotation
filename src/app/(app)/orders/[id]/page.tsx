import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Store } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { canViewOrderAmounts, canViewSupplier } from "@/lib/price-visibility";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { payableTotal } from "@/lib/quote";
import { isClientRestricted, CLIENT_HIDDEN } from "@/lib/client-visibility";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, workflowRoleLabel, WORKFLOW_ROLE_KEYS, type WorkflowRoleKey } from "@/lib/workflow-roles";
import {
  readOrderWorkflow,
  ORDER_STAGES,
  APPROVAL_STEPS,
  stageIndex,
  PRODUCTION_DEPTS,
  deptRole,
  deptLabel,
  stageLabel,
  stagePhase,
  pendingStep,
  type OrderStage,
  type ProductionDeptKey,
  type FulfillmentMode,
} from "@/lib/order-workflow";
import { purchaseStepsFrom, isPoApproved, effectiveStepRole, PR_STATUS_LABEL, isDeptRequisition, prMainIndex, type PRStatus } from "@/lib/purchasing";
import { buildPurchaseTrail, buildReturnViews, buildReconcileView } from "@/lib/purchase-chain-row";
import { getVoucherNoByPr } from "@/lib/purchase-voucher";
import { coercePurchaseOrder, poLinesFromPRItems } from "@/lib/purchase-order";
import { getSuppliers } from "@/lib/suppliers";
import { getProducts } from "@/lib/product-catalog";
import { getPaymentTerms } from "@/lib/payment-terms";
import { getHideOrderProgress, progressHiddenFor } from "@/lib/order-progress-visibility";
import { saleFromClassification, collectedTotal, closeDocsState, PAYMENT_KIND_LABEL } from "@/lib/sale";
import {
  mbSteps,
  mbProgress,
  mbStepRoles,
  mbBatchedByDescription,
  mbDeliveredByDescription,
  isMbDelivered,
  isMbFiled,
  type MBRole,
} from "@/lib/delivery-multibatch";
import { MultiBatchPanel } from "./multi-batch-panel";
import { MultiDeliveryEntry } from "./multi-delivery-entry";
import { BatchDeliveryToggle } from "./batch-delivery-toggle";
import { MultiBatchPickupToggle } from "./multi-batch-pickup-toggle";
import { FulfillmentModeSelector } from "./fulfillment-mode-selector";
import { COMPANY } from "@/lib/config";
import { JobOrderManager } from "./job-order-manager";
import { DeptProductionControls } from "./dept-production-controls";
import { FansJobOrderPanel } from "./fans-job-order-panel";
import { AutofillJobOrdersButton } from "./autofill-jo-button";
import { DuctJobOrderPanel } from "./duct-job-order-panel";
import { formatDuctJoNumber } from "@/lib/duct-job-order";
import { AccessoriesJobOrderPanel } from "./accessories-job-order-panel";
import { formatAccessoriesJoNumber, accessoriesJobRemarks } from "@/lib/accessories-job-order";
import { MotorControllerJobOrderPanel } from "./motor-controller-job-order-panel";
import { quotationJobOrderDepts } from "@/lib/job-order-autogen";
import { formatMotorControllerJoNumber } from "@/lib/motor-controller-job-order";
import { ConversationLog } from "./conversation-log";
import { AdminWorkflowOverride } from "./admin-workflow-override";
import { MaterialRequests } from "./material-requests";
import { PurchasingChain } from "./purchasing-chain";
import { BoughtInProduction } from "./bought-in-production";
import { orderBoughtInLines, isStockOnlyOrder, orderStockLines, isDuctHardwareStockOnly } from "@/lib/department-pnl";
import { StockRelease } from "./stock-release";
import { FulfillmentActions } from "./fulfillment-actions";
import { CommissionFlow } from "./commission-flow";
import { SaleDocumentList } from "./sale-document-list";
import { AutoRefresh } from "@/components/auto-refresh";

export const dynamic = "force-dynamic";

const STAGE_VARIANT: Record<OrderStage, "secondary" | "warning" | "success"> = {
  payment_review: "secondary",
  docs_checked: "warning",
  released: "success",
  in_production: "warning",
  jo_received: "warning",
  producing: "warning",
  production_finished: "success",
  final_pay_review: "secondary",
  final_pay_checked: "warning",
  final_pay_cleared: "warning",
  qa_tested: "warning",
  qa_plant_checked: "warning",
  qa_transferred: "warning",
  qa_sales_checked: "warning",
  delivery_docs_ready: "warning",
  delivered: "warning",
  delivery_confirmed: "warning",
  docs_surrendered: "warning",
  docs_received: "warning",
  closed: "success",
};

const fmtWhen = (iso?: string) => (iso ? formatDateTime(iso) : "");

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [quote, viewer, assignments, purchaseRequests, stockItemsRaw, allUsers, suppliers, paymentTerms, hideOrderProgress] = await Promise.all([
    prisma.quotation.findUnique({
      where: { id },
      include: {
        inquiry: { include: { customer: true } },
        preparedBy: true,
        items: { select: { qty: true, descriptionSnapshot: true, specsSnapshot: true } },
      },
    }),
    getCurrentUser(),
    getWorkflowRoles(),
    prisma.purchaseRequest.findMany({ where: { quotationId: id }, orderBy: { createdAt: "asc" } }),
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, quantity: true } }).catch(() => []),
    prisma.user.findMany({ select: { id: true, name: true } }),
    getSuppliers().catch(() => []),
    getPaymentTerms().catch(() => []),
    getHideOrderProgress().catch(() => false),
  ]);
  if (!quote) notFound();
  // Enrich stock items with what's actually free to issue (on hand − active
  // reservations), the same figure the availability lookup shows — so the MRF
  // panels can hide "Issue" for anything not in stock.
  const stockResv = stockItemsRaw.length
    ? await prisma.stockReservation
        .groupBy({ by: ["stockItemId"], where: { active: true, stockItemId: { in: stockItemsRaw.map((s) => s.id) } }, _sum: { qty: true } })
        .catch(() => [] as { stockItemId: string; _sum: { qty: number | null } }[])
    : [];
  const reservedById = new Map(stockResv.map((r) => [r.stockItemId, Number(r._sum.qty ?? 0)]));
  const stockItems = stockItemsRaw.map((s) => ({
    id: s.id,
    name: s.name,
    unit: s.unit,
    available: Math.round((Number(s.quantity) - (reservedById.get(s.id) ?? 0)) * 1000) / 1000,
  }));
  // Catalogue of purchasable products (for the MRF autocomplete); may be empty
  // before the product table is migrated.
  const productOptions = await getProducts().then((ps) => ps.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }))).catch(() => []);
  // Sales commission (exists once the order is closed) — for the post-close
  // commission sign-offs and the "issued 15 days after the sales month" due date.
  const commissionRow = await prisma.commission.findUnique({ where: { quotationId: id } }).catch(() => null);

  const adminViewer = isAdmin(viewer);
  // PO money amounts show only to the money-handling roles (Purchaser,
  // Accounting, Payment Approver) + Engineers/admins; hidden from production,
  // warehouse, logistics, QC and Sales monitors.
  const showAmounts = canViewOrderAmounts(viewer, assignments);
  const showSupplier = canViewSupplier(viewer, assignments);
  const wf = readOrderWorkflow(quote.classification);
  // Sale record (PO, payments, closing documents) — the closing docs reflect
  // between the quotation Sale panel and this order's close step.
  const saleForClose = saleFromClassification(quote.classification);
  const value = payableTotal(quote);
  // Shop-floor roles must not see client identity or purchase amounts.
  const restricted = await isClientRestricted(viewer, assignments);
  const custName = restricted ? CLIENT_HIDDEN : quote.inquiry.customer.company;

  // Admin toggle: hide workflow progress from Sales & Engineer (who hold no
  // workflow role). They still see the order header and financials.
  const progressHidden = progressHiddenFor(hideOrderProgress, viewer, adminViewer, assignments);
  if (progressHidden) {
    return (
      <div className="space-y-5">
        <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Orders
        </Link>
        <div>
          <h1 className="text-2xl font-bold">
            {restricted ? custName : <Link href={`/customers/${quote.inquiry.customer.id}`} className="hover:underline">{custName}</Link>}
          </h1>
          <p className="text-sm text-muted-foreground">
            Order{" "}
            <Link href={`/quotations/${quote.id}`} className="text-primary hover:underline">{quote.quoteNumber}</Link>
            {!restricted && (quote.projectName || quote.inquiry.projectName) && ` · ${quote.projectName ?? quote.inquiry.projectName}`}
            {!restricted && (
              <>
                {" · "}
                {formatCurrency(value, quote.currency)}
                {" · "}
                <Link href={`/customers/${quote.inquiry.customer.id}`} className="font-medium text-primary hover:underline">{custName}</Link>
              </>
            )}
          </p>
        </div>
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium">Order processing is in progress.</p>
            <p className="mt-1 text-sm text-muted-foreground">Workflow details are managed by the production and finance teams.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Resolve workflow roles → the people who hold them, so every viewer can see
  // who the current approver is.
  const userName = new Map(allUsers.map((u) => [u.id, u.name] as const));
  const namesForRole = (role: WorkflowRoleKey): string[] =>
    usersWithWorkflowRole(assignments, role).map((uid) => userName.get(uid)).filter((n): n is string => !!n);
  const approverLabel = (role: WorkflowRoleKey): string => {
    const names = namesForRole(role);
    return `${workflowRoleLabel(role)}${names.length ? ` — ${names.join(", ")}` : " (unassigned)"}`;
  };
  // Workflow role key → assigned approver names, for the blinking "awaiting
  // approval" highlights (fulfillment & commission).
  const approvers: Record<string, string[]> = Object.fromEntries(
    WORKFLOW_ROLE_KEYS.map((k) => [k, namesForRole(k as WorkflowRoleKey)]),
  );
  // The designation (job title) each approval step is performed in. Shown next
  // to the approver's name on every sign-off.
  const APPROVAL_DESIGNATION: Record<string, string> = {
    doc_check: workflowRoleLabel("accounting"),
    payment_cleared: workflowRoleLabel("payment_approver"),
    client_notified: "Sales",
    final_pay_checked: workflowRoleLabel("accounting"),
    final_pay_confirmed: workflowRoleLabel("payment_approver"),
    qa_tested: `${workflowRoleLabel("technical_head")} / ${workflowRoleLabel("quality_inspector")}`,
    qa_plant_checked: workflowRoleLabel("plant_manager"),
    qa_transferred: workflowRoleLabel("logistics"),
    qa_sales_checked: "Sales",
    delivery_approved: workflowRoleLabel("accounting"),
    delivered: workflowRoleLabel("logistics"),
    delivery_confirmed: "Sales",
    docs_surrendered: workflowRoleLabel("logistics"),
    docs_received: workflowRoleLabel("accounting"),
    documents_filed: workflowRoleLabel("accounting"),
  };
  const designationOf = (key: string): string => APPROVAL_DESIGNATION[key] ?? "";
  // "Name (Designation)" — or just the name when no designation maps.
  const withDesig = (name: string, designation: string) => (designation ? `${name} (${designation})` : name);

  const canIssue =
    ["released", "in_production", "jo_received", "producing"].includes(wf.stage) &&
    (adminViewer || viewer?.role === "ENGINEER" || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "technical_head" as WorkflowRoleKey)));

  // The Plant Manager receives the released job orders before production begins.
  const canReceive =
    wf.stage === "in_production" &&
    (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "plant_manager" as WorkflowRoleKey)));

  // The Engineer (or admin) makes the Fans & Blowers job order. New job orders
  // can no longer be added once the order is In Production (or later).
  const canManageJO = adminViewer || viewer?.role === "ENGINEER";
  const inProductionOrLater = stageIndex(wf.stage) >= stageIndex("producing");

  // Per-department production controls (Issue / Start production / Mark finished),
  // shown on each department's job-order panel.
  const deptCtrl = (deptKey: ProductionDeptKey) => {
    const jo = wf.jobOrders[deptKey];
    const status = jo?.status ?? null;
    const nextTo: "in_production" | "finished" | null =
      status === "issued" ? "in_production" : status === "in_production" ? "finished" : null;
    const nextLabel = nextTo === "in_production" ? "Start production" : nextTo === "finished" ? "Mark Finished" : null;
    const isDeptHead = adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(deptKey) as WorkflowRoleKey));
    const canAdvance =
      nextTo != null &&
      (wf.stage === "jo_received" || wf.stage === "producing") &&
      isDeptHead;
    const awaitingReceive = status === "issued" && wf.stage === "in_production";
    // Proofing pictures: the department head (or an admin) may attach/remove
    // while the job order is open (not yet finished); everyone else views only.
    const proofs = jo?.proofs ?? [];
    // The dept head (or admin) may ADD proof pictures any time the job order
    // exists — including after it's marked finished. Removing a proof stays
    // limited to before finish for the dept head; an admin may remove any time.
    const canAddProofs = isDeptHead && status != null;
    const canRemoveProofs = adminViewer || (isDeptHead && status != null && status !== "finished");
    return { status, canIssue, canAdvance, nextTo, nextLabel, awaitingReceive, proofs, canAddProofs, canRemoveProofs };
  };

  // A job order is visible to its own department head. Sales, Engineers, Admins,
  // the Purchaser, Payment Approver, Technical Head, Plant Manager and the Quality
  // Inspectors (1st QC / Sales 2nd QC) see every department's job orders — the QC
  // roles need the production proof pictures to verify the work. Visibility never
  // depends on the order's stage, so job orders stay viewable even after
  // production is finished or the order is closed.
  const seesAllJobOrders =
    adminViewer ||
    viewer?.role === "SALES" ||
    viewer?.role === "ENGINEER" ||
    (viewer != null &&
      (["purchaser", "payment_approver", "technical_head", "plant_manager", "quality_inspector", "quality_inspector_2"] as WorkflowRoleKey[]).some((r) =>
        userHasWorkflowRole(assignments, viewer.id, r),
      ));
  const canRoleSeeDeptJO = (deptKey: ProductionDeptKey): boolean =>
    seesAllJobOrders || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(deptKey) as WorkflowRoleKey));
  // Departments the paid quotation actually has fabricable items for — a section
  // for a department the order doesn't touch is hidden. Never hide a department
  // that already has a job order created (manually added or issued), so existing
  // work is never lost.
  const joDepts = quotationJobOrderDepts(quote.items);
  const deptJoArrays: Record<ProductionDeptKey, unknown[]> = {
    fans: wf.fansJobOrders, duct: wf.ductJobOrders, accessories: wf.accessoriesJobOrders, motor: wf.motorJobOrders,
  };
  const deptHasContent = (deptKey: ProductionDeptKey): boolean =>
    joDepts[deptKey] || (deptJoArrays[deptKey]?.length ?? 0) > 0 || !!wf.jobOrders[deptKey];
  const canSeeDeptJO = (deptKey: ProductionDeptKey): boolean =>
    canRoleSeeDeptJO(deptKey) && deptHasContent(deptKey);

  // A fully bought-in order (bought-in products, nothing fabricated) skips
  // production and its Office-side roles handle the Phase 5 quality steps.
  const boughtInProductLines = orderBoughtInLines(quote.items);
  const boughtInOnly = boughtInProductLines.length > 0 && !PRODUCTION_DEPTS.some((d) => deptHasContent(d.key));
  // A from-stock order (in-house duct hardware — nothing fabricated or bought from
  // a supplier) is released from Fans & Blowers stock in Phase 2 instead of job
  // orders or a PO. Like bought-in, it skips production and Office-side roles run QA.
  const stockOnly = isStockOnlyOrder(quote.items) && !PRODUCTION_DEPTS.some((d) => deptHasContent(d.key));
  // Sign-off designations vary by fulfilment mode / sourcing — the same stage key is
  // performed by a different role across delivery / office pick up / plant pick up.
  {
    const _office = wf.officePickup === true;
    const _plant = wf.fulfillmentMode === "plant_pickup";
    // Quality test: office pick up = 2nd Quality Inspector; from-stock (delivery/plant) = Warehouse.
    if (_office) APPROVAL_DESIGNATION.qa_tested = workflowRoleLabel("quality_inspector_2");
    else if (stockOnly) APPROVAL_DESIGNATION.qa_tested = workflowRoleLabel("warehouse");
    if (_plant) {
      // Plant pick up reuses the QA stage keys for different actors: the Warehouse makes
      // the delivery form (qa_transferred), the Plant Manager approves delivery
      // (qa_sales_checked), and the Warehouse uploads the proof of pick up (delivered).
      APPROVAL_DESIGNATION.qa_transferred = workflowRoleLabel("warehouse");
      APPROVAL_DESIGNATION.qa_sales_checked = workflowRoleLabel("plant_manager");
      APPROVAL_DESIGNATION.delivered = workflowRoleLabel("warehouse");
      // From-stock plant pick up notifies the client via the Plant Manager's release approval.
      if (stockOnly) APPROVAL_DESIGNATION.client_notified = workflowRoleLabel("plant_manager");
    }
  }
  const stockLines = stockOnly ? orderStockLines(quote.items) : [];
  // Retained for the pendingStep signature; the from-stock release role now depends on
  // the fulfilment mode (delivery → PM releases + Sales notifies; office pickup → Sales;
  // plant pickup → Warehouse releases + PM approves) rather than duct-hardware gating.
  const engineerApprovesStock = stockOnly && isDuctHardwareStockOnly(quote.items);

  // Live "who acts next" for the whole order. `stockOnly` routes the "released"
  // stage to the from-stock release path (by fulfilment mode) rather than the
  // bought-in Purchase Order step.
  const pend = pendingStep(wf, stockOnly, engineerApprovesStock, wf.officePickup === true, wf.fulfillmentMode === "plant_pickup");
  const pendingApprovers: string[] = pend
    ? pend.sales
      ? [`Sales${quote.preparedBy?.name ? ` — ${quote.preparedBy.name}` : ""}`]
      : [...(pend.engineer ? ["Engineer"] : []), ...pend.roles.map(approverLabel)]
    : [];
  // Bought-in / from-stock orders relabel a couple of stages (no JO creation / no Plant QC).
  const displayStageLabel = (key: OrderStage): string => {
    if (boughtInOnly && key === "released") return "For PO creation";
    if (stockOnly && key === "released") return "For stock release";
    // Bought-in skips the plant quality steps and lands here ready to transfer.
    if (boughtInOnly && key === "qa_plant_checked") return "For transfer to office";
    return stageLabel(key);
  };

  const jobs = PRODUCTION_DEPTS.filter((d) => wf.jobOrders[d.key] && canSeeDeptJO(d.key)).map((d) => {
    const jo = wf.jobOrders[d.key]!;
    const nextTo: "in_production" | "finished" | null =
      jo.status === "issued" ? "in_production" : jo.status === "in_production" ? "finished" : null;
    const nextLabel = nextTo === "in_production" ? "Start production" : nextTo === "finished" ? "Mark Finished" : null;
    const canAdvance =
      nextTo != null &&
      (wf.stage === "jo_received" || wf.stage === "producing") &&
      (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(d.key) as WorkflowRoleKey)));
    const issueDesig = workflowRoleLabel("technical_head" as WorkflowRoleKey);
    const deptDesig = workflowRoleLabel(deptRole(d.key) as WorkflowRoleKey);
    const events: { label: string; who: string; designation: string; when: string }[] = [];
    if (jo.issuedByName) events.push({ label: "Issued", who: jo.issuedByName, designation: issueDesig, when: fmtWhen(jo.issuedAt) });
    if (jo.startedByName) events.push({ label: "Started", who: jo.startedByName, designation: deptDesig, when: fmtWhen(jo.startedAt) });
    if (jo.finishedByName) events.push({ label: "Finished", who: jo.finishedByName, designation: deptDesig, when: fmtWhen(jo.finishedAt) });
    // Only an Engineer or an admin may set / change a job order's deadline.
    const canSetDue = adminViewer || viewer?.role === "ENGINEER";
    return {
      key: d.key,
      label: d.label,
      status: jo.status,
      dueAt: jo.dueAt ?? null,
      canSetDue,
      events,
      canAdvance,
      nextTo,
      nextLabel,
    };
  });

  const docCheck = wf.approvals.doc_check;
  const payCleared = wf.approvals.payment_cleared;

  // Phase 5 & 6 — delivery & closeout permissions + trail.
  const hasRole = (role: WorkflowRoleKey) =>
    adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, role));
  const isSalesViewer =
    adminViewer || (viewer != null && (viewer.id === quote.preparedById || viewer.role === "SALES" || viewer.role === "ENGINEER"));
  // A BOUGHT-IN order skips the plant — Logistics / Engineer / Sales / Payment
  // Approver / admin handle its quality steps. A FROM-STOCK order's goods are at
  // the plant, so the Warehouse runs the quality test and the Plant Manager
  // approves (like a produced order).
  const officeQaActors = isSalesViewer || hasRole("logistics") || hasRole("payment_approver");
  const boughtInQa = boughtInOnly && officeQaActors;
  // From-stock release (Phase 2) — who does the physical release (step 1), the Plant
  // Manager approval (step 2) and the Sales client-notify (step 3, delivery only)
  // depends on the fulfilment mode (plant vs office are far apart). Office pick up →
  // Sales releases (+notifies) in one step. Plant pick up → Warehouse releases, Plant
  // Manager approves. Delivery → Warehouse releases, Plant Manager approves, Sales notifies.
  const canReleaseStock = adminViewer || (
    wf.officePickup === true ? isSalesViewer : hasRole("warehouse"));
  const canConfirmRelease = adminViewer || hasRole("plant_manager");
  const canNotifyRelease = adminViewer || isSalesViewer;
  // Plant pick up: Warehouseman-driven tail (make form / upload POD) with Plant
  // Manager quality & approve-delivery. Its Phase-5 roles differ from delivery.
  const plantPick = wf.fulfillmentMode === "plant_pickup";
  const perms = {
    canNotify: isSalesViewer,
    canCheckPay: hasRole("accounting"),
    canConfirmPay: hasRole("payment_approver"),
    canQaTest: wf.officePickup === true
      ? officeQaActors || hasRole("quality_inspector_2" as WorkflowRoleKey)
      : stockOnly
        ? hasRole("warehouse") // from-stock: delivery OR plant pick up
        : plantPick
          ? hasRole("technical_head") || hasRole("quality_inspector") // produced plant pick up
          : boughtInOnly
            ? boughtInQa
            : hasRole("technical_head") || hasRole("quality_inspector"),
    canQaPlant: plantPick ? hasRole("plant_manager") : boughtInOnly ? boughtInQa : hasRole("plant_manager"),
    // qa_plant_checked step: Warehouseman "make delivery form" for plant, else Logistics transfer.
    canQaTransfer: plantPick ? hasRole("warehouse") : hasRole("logistics"),
    // qa_transferred step: Plant Manager "approve delivery" for plant, else Sales 2nd QC.
    canQaSales: plantPick ? hasRole("plant_manager") : isSalesViewer || hasRole("quality_inspector_2" as WorkflowRoleKey),
    canPrepDocs: hasRole("accounting"),
    // qa_sales_checked / delivery step: Warehouseman uploads POD for plant, else Logistics delivers.
    canDeliver: plantPick ? hasRole("warehouse") : hasRole("logistics"),
    canApproveDelivery: isSalesViewer,
    canSurrender: hasRole("logistics"),
    canFile: hasRole("accounting"),
    canApproveComm: hasRole("payment_approver"),
    canAccountingComm: hasRole("accounting"),
  };
  const A = wf.approvals;
  const fStamp = (label: string, key: string, a?: { byName: string; at: string }) =>
    a ? `${label} — ${withDesig(a.byName, designationOf(key))} · ${fmtWhen(a.at)}` : null;
  const fTrail: string[] = [
    fStamp("Client notified", "client_notified", A.client_notified),
    fStamp("Final payment checked", "final_pay_checked", A.final_pay_checked),
    fStamp("Final payment confirmed", "final_pay_confirmed", A.final_pay_confirmed),
    fStamp("Quality tested", "qa_tested", A.qa_tested),
    fStamp("Plant QC & quantity passed", "qa_plant_checked", A.qa_plant_checked),
    // Plant pick up reuses these QA keys for the delivery-form / approve-delivery steps.
    fStamp(plantPick ? "Delivery form made" : "Transferred to office", "qa_transferred", A.qa_transferred),
    fStamp(plantPick ? "Delivery approved" : boughtInOnly ? "Quality & quantity checked" : "Sales 2nd QC & quantity passed", "qa_sales_checked", A.qa_sales_checked),
    fStamp("Delivery approved", "delivery_approved", A.delivery_approved),
    fStamp(plantPick || wf.officePickup === true ? "Picked up" : "Delivered", "delivered", A.delivered),
    fStamp(plantPick || wf.officePickup === true ? "Pick up confirmed" : "Delivery confirmed", "delivery_confirmed", A.delivery_confirmed),
    fStamp("Documents surrendered", "docs_surrendered", A.docs_surrendered),
    fStamp("Documents received", "docs_received", A.docs_received),
    fStamp("Documents filed", "documents_filed", A.documents_filed),
  ].filter((s): s is string => s !== null);

  // Admin rollback: earlier stages to return to + the sign-offs on record. Both the
  // stage dropdown and the approval list read like THIS order's real workflow — the
  // labels track the fulfilment mode (delivery / office / plant pick up) and sourcing
  // (produced / from-stock / bought-in), instead of the generic produced-delivery
  // wording. A pick-up order collects, not "delivers"; plant pick up makes a delivery
  // form and the Plant Manager approves it (no office transfer / Sales 2nd QC).
  const isPickup = plantPick || wf.officePickup === true;
  const rbApprovalLabel = (key: string): string => {
    switch (key) {
      case "payment_cleared":
        return stockOnly || boughtInOnly ? "Payment cleared" : "Payment cleared & JO created";
      case "client_notified":
        return stockOnly ? "Released from stock & client notified" : "Client notified (order ready)";
      case "qa_transferred":
        return plantPick ? "Delivery form made" : "Transferred to office";
      case "qa_sales_checked":
        return plantPick ? "Delivery approved" : boughtInOnly ? "Quality & quantity checked" : "Sales 2nd QC & quantity passed";
      case "delivered":
        return isPickup ? "Picked up" : "Delivered";
      case "delivery_confirmed":
        return isPickup ? "Pick up confirmed" : "Delivery confirmed";
      default:
        return APPROVAL_STEPS[key]?.label ?? key;
    }
  };
  const rbStageLabel = (key: string, base: string): string => {
    switch (key) {
      case "released":
        return stockOnly ? "For stock release" : boughtInOnly ? "For purchasing" : "For JO creation";
      case "qa_transferred":
        return plantPick ? "Delivery form made" : "Transferred to office";
      case "qa_sales_checked":
        return plantPick ? "Delivery approved" : "Sales re-checked";
      case "delivered":
        return isPickup ? "Picked up" : "Delivered";
      case "delivery_confirmed":
        return isPickup ? "Pick up confirmed" : "Delivery confirmed";
      default:
        return base;
    }
  };
  // Non-produced orders (from-stock / bought-in) skip the production stages
  // entirely, so they aren't offered as roll-back targets.
  const PRODUCTION_ONLY_STAGES = new Set<string>(["in_production", "jo_received", "producing", "production_finished"]);
  const curStageIdx = stageIndex(wf.stage);
  const priorStages = ORDER_STAGES
    .filter((s, i) => i < curStageIdx && !((stockOnly || boughtInOnly) && PRODUCTION_ONLY_STAGES.has(s.key)))
    .map((s) => ({ key: s.key, label: rbStageLabel(s.key, s.label) }));
  const rollbackApprovals = Object.entries(wf.approvals)
    .filter(([k]) => APPROVAL_STEPS[k])
    .map(([k, a]) => ({ key: k, label: rbApprovalLabel(k), byName: a.byName, at: fmtWhen(a.at) }))
    .sort((x, y) => stageIndex(APPROVAL_STEPS[x.key].to) - stageIndex(APPROVAL_STEPS[y.key].to));
  const fulfillmentStages = new Set([
    "production_finished", "final_pay_review", "final_pay_checked", "final_pay_cleared",
    "qa_tested", "qa_plant_checked", "qa_transferred", "qa_sales_checked",
    "delivery_docs_ready", "delivered", "delivery_confirmed", "docs_surrendered", "docs_received", "closed",
  ]);
  const showFulfillment = fulfillmentStages.has(wf.stage);
  // Payments already recorded on the sale (e.g. a one-time full payment) — their
  // proofs are surfaced read-only at the final-payment check so the approver can
  // view the payment made before signing off.
  const recordedPayments = (saleForClose?.payments ?? []).map((p) => ({
    label: `${PAYMENT_KIND_LABEL[p.kind]} · ${formatCurrency(Number(p.amount) || 0, quote.currency)}${p.date ? ` · ${fmtWhen(p.date)}` : ""}`,
    proof: p.proof ?? null,
  }));
  // Same collected-payment records surfaced in the multi-batch panel (with the
  // payment id, for a stable key) — kept in sync with the quotation tab because
  // both read the one sale record.
  const mbPayments = (saleForClose?.payments ?? []).map((p) => ({
    id: p.id,
    label: `${PAYMENT_KIND_LABEL[p.kind]} · ${formatCurrency(Number(p.amount) || 0, quote.currency)}${p.date ? ` · ${fmtWhen(p.date)}` : ""}`,
    proof: p.proof ?? null,
  }));

  // Sales-commission info for the post-close sign-offs. Due date = the 15th day
  // after the sales month ends ("issued 15 days after the sales month").
  const commissionInfo = commissionRow
    ? {
        amount: Number(commissionRow.amount),
        currency: quote.currency,
        salesMonth: commissionRow.salesMonth,
        dueLabel: ((): string => {
          const [y, m] = commissionRow.salesMonth.split("-").map(Number);
          if (!y || !m) return "";
          const d = new Date(y, m, 0); // last day of the sales month
          d.setDate(d.getDate() + 15);
          return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
        })(),
        flow: wf.commission ?? {},
      }
    : null;
  // The sales commission stays hidden until the client has fully paid the order
  // (amount collected covers the payable total, within a rounding tolerance).
  const fullyPaid = value > 0 && collectedTotal(saleForClose) >= value - 0.005;
  const phase6Active =
    wf.stage === "closed" &&
    !!commissionInfo &&
    fullyPaid &&
    // Multi-batch handles closing documents per batch, so the order-level
    // closing-docs gate only applies to the single-batch flow.
    (wf.deliveryMode === "multi" || closeDocsState(saleForClose?.docs, quote.vatMode !== "EXCLUSIVE", quote.vatMode === "ZERO_RATED").complete);

  // Multiple-batch delivery — a separate opt-in mode (never active alongside the
  // single-batch Phase 5 flow). Chosen by Sales/admin as soon as production has
  // started (so finished items can go out while the rest is still being made),
  // right up until the single-batch delivery begins.
  const isPreparerViewer = viewer != null && viewer.id === quote.preparedById;
  const multiMode = wf.deliveryMode === "multi";
  const canManageMulti = adminViewer || isPreparerViewer;
  // Only an Engineer, the Payment Approver or an admin may enable batch delivery.
  const canEnableBatch =
    adminViewer || viewer?.role === "ENGINEER" || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "payment_approver" as WorkflowRoleKey));
  const batchEnabled = wf.batchDeliveryEnabled === true;
  // "Office pick up" — client collects at the office instead of a delivery.
  // Step 1: persisted flag + tag only (no Phase 5 change yet). Set by the order's
  // salesperson or an admin.
  const officePickup = wf.officePickup === true;
  // Fulfilment/handover mode (Delivery / Office pick up / Plant pick up). The
  // selector offers the modes the order's items allow: office pick up = from-stock or
  // bought-in; plant pick up = goods at the plant (not bought-in-only). Who may change
  // it: Sales, an Engineer, the Payment Approver or an admin. An admin can change it any
  // time; the others only while the order is still in Phase 2 (the pickup window).
  const pickupWindowOpen = stageIndex(wf.stage) <= stageIndex("released");
  const canSetMode = adminViewer || ((isSalesViewer || hasRole("payment_approver")) && pickupWindowOpen);
  const availableModes: FulfillmentMode[] = [
    "delivery",
    // Office pick up — the client collects at the office. Available for from-stock and
    // bought-in orders (both are handed over from the office, not the plant).
    ...(stockOnly || boughtInOnly ? (["office_pickup"] as FulfillmentMode[]) : []),
    // Plant pick up — goods at the plant (produced or F&B stock; not bought-in).
    ...(!boughtInOnly ? (["plant_pickup"] as FulfillmentMode[]) : []),
  ];
  // The enable toggle shows to authorized roles from when production starts up
  // until just before the order is actually delivered — so an order can still be
  // switched to batch delivery even after the single-delivery flow has begun
  // (final payment / QA / delivery-doc stages). The entry panel shows once the
  // toggle is on. Switching is blocked once the order is delivered/closed.
  const inDeliveryWindow =
    stageIndex(wf.stage) >= stageIndex("producing") && stageIndex(wf.stage) < stageIndex("delivered");
  // The normal delivery batch toggle is not used for pickup orders — office pickup
  // gets the dedicated "Multi-batch pick up" toggle below; plant pickup multi-batch
  // is a separate change.
  const showBatchToggle = inDeliveryWindow && !multiMode && canEnableBatch && !officePickup && !plantPick;
  const showMultiEntry =
    inDeliveryWindow && !multiMode && batchEnabled && (canManageMulti || canEnableBatch) && !officePickup && !plantPick;
  // Office / plant pick up: a single "Multi-batch pick up" toggle. The salesperson
  // or an admin can turn it on; only an admin can turn it off (enforced server-side).
  const isPickupMode = officePickup || plantPick;
  const showPickupMultiToggle = isPickupMode && inDeliveryWindow && !multiMode && (adminViewer || isPreparerViewer);
  const mbOrdered = new Map<string, number>();
  for (const it of quote.items) {
    const k = it.descriptionSnapshot.trim();
    if (k) mbOrdered.set(k, (mbOrdered.get(k) ?? 0) + it.qty);
  }
  const mbBatchedMap = mbBatchedByDescription(wf.deliveryBatches);
  const mbDeliveredMap = mbDeliveredByDescription(wf.deliveryBatches);
  const mbItems = [...mbOrdered.entries()].map(([description, ordered]) => ({
    description,
    ordered,
    batched: mbBatchedMap.get(description.toLowerCase()) ?? 0,
    delivered: mbDeliveredMap.get(description.toLowerCase()) ?? 0,
  }));
  const canActMbStep = (role: MBRole): boolean =>
    adminViewer || (role === "sales" ? isPreparerViewer : viewer != null && userHasWorkflowRole(assignments, viewer.id, role as WorkflowRoleKey));
  // A step may allow more than one role (e.g. the produced quality test — Technical
  // Head OR 1st Quality Inspector). The viewer can act if they hold ANY of them.
  const canActMbRoles = (roles: MBRole[]): boolean => roles.some(canActMbStep);
  const mbPaymentById = new Map((saleForClose?.payments ?? []).map((p) => [p.id, p] as const));
  const mbBatchViews = wf.deliveryBatches.map((b) => {
    const steps = mbSteps(wf.fulfillmentMode, stockOnly, boughtInOnly).map((s) => {
      const st = b.steps[s.key];
      return { key: s.key, label: s.done, roleLabel: s.role === "sales" ? "Sales" : workflowRoleLabel(s.role), done: !!st, byName: st?.byName, at: st?.at ? fmtWhen(st.at) : undefined };
    });
    const { next } = mbProgress(b, wf.fulfillmentMode, stockOnly, boughtInOnly);
    const nextView = next && !b.cancelled
      ? { key: next.key, label: next.label, roleLabel: mbStepRoles(next).map((r) => (r === "sales" ? "Sales" : workflowRoleLabel(r))).join(" or "), canAct: canActMbRoles(mbStepRoles(next)), collectsPayment: !!next.collectsPayment }
      : null;
    return {
      id: b.id,
      drNumber: b.drNumber,
      createdByName: b.createdByName,
      lines: b.lines,
      pod: b.pod ?? [],
      docs: b.docs ?? {},
      paymentAmount: b.paymentAmount,
      paymentProof: b.paymentId ? mbPaymentById.get(b.paymentId)?.proof ?? null : null,
      paymentId: b.paymentId ?? null,
      cancelled: !!b.cancelled,
      delivered: isMbDelivered(b),
      filed: isMbFiled(b),
      steps,
      next: nextView,
      canCancel: adminViewer || b.createdByName === viewer?.name || isPreparerViewer,
    };
  });

  // Materials (Phase 3, part 1): raise MRFs (dept head, during production) and
  // warehouse issue/escalate.
  const canWarehouse =
    adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "warehouse" as WorkflowRoleKey));
  // Releasing purchased materials to the requesting department — Warehouse,
  // Purchaser, Payment Approver or an admin.
  const canReleaseMaterials =
    canWarehouse ||
    (viewer != null &&
      (["purchaser", "payment_approver"] as WorkflowRoleKey[]).some((r) => userHasWorkflowRole(assignments, viewer.id, r)));
  // An authorized department head (or admin) may raise their department's MRF at
  // any time during production — from when the job orders are released until
  // production is finished. No longer gated on that department's own job order
  // having been individually started.
  const productionFinished = stageIndex(wf.stage) >= stageIndex("production_finished");
  const productionUnderway = stageIndex(wf.stage) >= stageIndex("in_production") && !productionFinished;
  // The Plant Manager oversees every production line, so they may raise an MRF
  // for any department; a department head raises only their own.
  const isPlantMgrViewer = viewer != null && userHasWorkflowRole(assignments, viewer.id, "plant_manager" as WorkflowRoleKey);
  const raisableDepts = productionUnderway
    ? PRODUCTION_DEPTS.filter(
        (d) => adminViewer || isPlantMgrViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(d.key) as WorkflowRoleKey)),
      ).map((d) => ({ key: d.key, label: d.label }))
    : [];
  // Link each MRF to the purchase request it was escalated into, so the MRF card
  // reflects the live purchasing-chain stage (approved → voucher → purchased → …).
  const prByMrf = new Map<string, (typeof purchaseRequests)[number]>();
  for (const pr of purchaseRequests) if (pr.mrfId) prByMrf.set(pr.mrfId, pr);
  const prBadge = (s: PRStatus): "secondary" | "warning" | "success" | "destructive" =>
    s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" || s === "CANCELLED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";
  // A material requisition is approved (or rejected) by the Plant Manager — the
  // "For purchasing" state only starts once they approve (workflow step 16).
  const canApprovePlant =
    adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "plant_manager" as WorkflowRoleKey));
  const materialReqs = wf.materialRequests.map((m) => {
    const linkedPr = prByMrf.get(m.id);
    const poStatus = linkedPr ? (linkedPr.status as PRStatus) : null;
    // Who must act next on the linked purchase request — designation + name —
    // for the flashing "awaiting" badge, mirroring the Phase 4 purchasing chain.
    let awaitingLabel: string | null = null;
    if (linkedPr && poStatus && poStatus !== "REJECTED" && poStatus !== "COMPLETED" && poStatus !== "CANCELLED") {
      const step = purchaseStepsFrom(poStatus, true, isPoApproved(linkedPr.chainLog))[0];
      if (step) {
        const role = effectiveStepRole(step, true);
        const names = namesForRole(role);
        awaitingLabel = `${workflowRoleLabel(role)}${names.length ? ` (${names.join(", ")})` : ""}`;
      }
    }
    return {
      awaitingLabel,
      id: m.id,
      formNo: m.formNo,
      orderId: quote.id,
      deptLabel: deptLabel(m.dept),
      items: m.items,
      note: m.note,
      status: m.status,
      poStatus,
      // Whether the purchase request already carries a supplier PO — lets the card
      // distinguish "approved, awaiting PO" from "approved, awaiting voucher".
      hasPo: linkedPr ? !!coercePurchaseOrder(linkedPr.po) : false,
      // Whether the Approver has approved the raised PO (chainLog.approve_po).
      poApproved: linkedPr ? isPoApproved(linkedPr.chainLog) : false,
      linkedPrId: linkedPr?.id ?? null,
      // The Plant Manager (or admin) approves/rejects a material request that is
      // still awaiting approval — right here on the Phase 3 MRF card.
      canApproveMaterials: canApprovePlant && poStatus === "PENDING_APPROVAL",
      poStatusLabel: poStatus ? PR_STATUS_LABEL[poStatus] : null,
      poStatusVariant: poStatus ? prBadge(poStatus) : null,
      raisedByName: m.raisedByName,
      date: m.raisedAt ? formatDateTime(m.raisedAt) : "",
      handledByName: m.handledByName,
      handledWhen: m.handledAt ? formatDateTime(m.handledAt) : "",
      // "requested" (nothing handled yet) or "partial" (some lines handled, some
      // still pending) — the warehouse can keep issuing / sending the remaining
      // lines. A single handled line no longer locks the rest out.
      canHandle: canWarehouse && (m.status === "requested" || m.status === "partial"),
      // The requesting department head (or an admin) can withdraw it before the
      // warehouse handles it.
      canCancel:
        m.status === "requested" &&
        (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(m.dept) as WorkflowRoleKey))),
      // Fulfillment handshake: the requesting department head confirms receipt
      // and can follow up; the Warehouse can inform the requestor of availability.
      receivedByName: m.receivedByName ?? null,
      isDeptHead: adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(m.dept) as WorkflowRoleKey)),
      canInform: canWarehouse,
      canRelease: canReleaseMaterials,
      releasedByName: m.releasedByName ?? null,
      confirmedByName: m.confirmedByName ?? null,
      confirmedWhen: m.confirmedAt ? formatDateTime(m.confirmedAt) : null,
      informedByName: m.informedByName ?? null,
      informedWhen: m.informedAt ? formatDateTime(m.informedAt) : null,
      followUpCount: m.followUps?.length ?? 0,
      lastFollowUpWhen: m.followUps && m.followUps.length ? formatDateTime(m.followUps[m.followUps.length - 1].at) : null,
    };
  });
  // Phase 3 (Materials + Purchasing) opens once the job orders are released
  // (production phase entered) and stays visible afterwards — including after
  // production is finished — so the MRFs and purchasing history remain readable.
  const showMaterials = stageIndex(wf.stage) >= stageIndex("in_production");
  // Hide the MRF View / Print document links from the production heads and the
  // Plant Manager (they raise/monitor requests but don't need the printable MRF).
  const hideMrfDoc =
    !adminViewer && viewer != null &&
    (["plant_manager", "prod_head_fans", "prod_head_duct", "prod_head_accessories", "prod_head_motor", "technical_head", "quality_inspector", "quality_inspector_2"] as WorkflowRoleKey[]).some((r) =>
      userHasWorkflowRole(assignments, viewer.id, r),
    );

  // Purchasing chain (Phase 3, part 2) — real PurchaseRequest rows.
  const prVariant = (s: PRStatus): "secondary" | "warning" | "success" | "destructive" =>
    s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";
  const canManagePO =
    adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "purchaser" as WorkflowRoleKey));
  const mrfNoById = new Map(wf.materialRequests.map((m) => [m.id, m.formNo]));
  // Printed cash-voucher number covering each purchase request (if any).
  const voucherNoByPr = await getVoucherNoByPr().catch(() => new Map<string, string>());
  const purchaseRows = purchaseRequests.map((pr) => {
    const status = pr.status as PRStatus;
    const prItems = Array.isArray(pr.items) ? (pr.items as string[]) : [];
    const trail = buildPurchaseTrail(pr);
    const prIsDept = isDeptRequisition(pr);
    const actions = purchaseStepsFrom(status, prIsDept, isPoApproved(pr.chainLog)).map((step) => {
      const role = effectiveStepRole(step, prIsDept);
      const names = namesForRole(role);
      return {
        key: step.key,
        label: step.label,
        roleLabel: `${workflowRoleLabel(role)}${names.length ? ` (${names.join(", ")})` : ""}`,
        canAct: adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, role)),
      };
    });
    return {
      id: pr.id,
      deptLabel: deptLabel(pr.dept as typeof PRODUCTION_DEPTS[number]["key"]),
      mrfNo: pr.mrfId ? mrfNoById.get(pr.mrfId) ?? null : null,
      items: prItems,
      note: pr.note,
      status,
      statusLabel: PR_STATUS_LABEL[status],
      variant: prVariant(status),
      trail,
      actions,
      po: coercePurchaseOrder(pr.po),
      poDefaultLines: poLinesFromPRItems(prItems),
      canManagePO,
      isDept: isDeptRequisition(pr),
      returns: buildReturnViews(pr),
      canRaiseReturn: false,
      returnAdvanceRoles: [],
      returnAdmin: false,
      reconcile: { ...buildReconcileView(pr), voucherNo: voucherNoByPr.get(pr.id) ?? null },
      canRecordReconcile: false,
      canSettleReconcile: false,
      canEscalateReconcile: false,
      canApproveReconcile: false,
    };
  });

  // A fully bought-in order (goods bought from a supplier, nothing fabricated)
  // skips production and follows the PO flow: clearing payment files the supplier
  // requisition, the Purchaser prepares the PO, the goods are bought, and Sales
  // then notifies the client (→ Phase 5). (`boughtInOnly` is computed above.)
  const supplierReqRaised = purchaseRows.some((r) => r.isDept && r.status !== "REJECTED");
  const supplierPoPrepared = purchaseRows.some((r) => r.isDept && r.status !== "REJECTED" && !!r.po);
  const supplierPurchased = purchaseRows.some((r) => r.isDept && prMainIndex(r.status as PRStatus) >= prMainIndex("PURCHASED"));
  const canNotifyBoughtIn = !restricted && (adminViewer || viewer?.role === "SALES" || viewer?.role === "ENGINEER" || quote.preparedById === viewer?.id);

  return (
    <div className="space-y-5">
      <AutoRefresh />
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {restricted ? custName : <Link href={`/customers/${quote.inquiry.customer.id}`} className="hover:underline">{custName}</Link>}
          </h1>
          <p className="text-sm text-muted-foreground">
            Order{" "}
            <Link href={`/quotations/${quote.id}`} className="text-primary hover:underline">{quote.quoteNumber}</Link>
            {!restricted && (quote.projectName || quote.inquiry.projectName) && ` · ${quote.projectName ?? quote.inquiry.projectName}`}
            {!restricted && (
              <>
                {" · "}
                {formatCurrency(value, quote.currency)}
                {" · "}
                <Link href={`/customers/${quote.inquiry.customer.id}`} className="font-medium text-primary hover:underline">{custName}</Link>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {wf.fulfillmentMode !== "delivery" && (
            <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
              <Store className="h-3.5 w-3.5" /> {wf.fulfillmentMode === "plant_pickup" ? "Plant pick up" : "Office pick up"}
            </Badge>
          )}
          <Badge variant={STAGE_VARIANT[wf.stage]} className="text-sm">{displayStageLabel(wf.stage)}</Badge>
        </div>
      </div>

      {/* Stage progress. Office pickup skips plant-QC → transfer → Sales-2nd-QC →
          delivered, so those chips are hidden for a pickup order. */}
      <div className="flex flex-wrap gap-1.5">
        {(officePickup
          ? ORDER_STAGES.filter((s) => !["qa_plant_checked", "qa_transferred", "qa_sales_checked", "delivered"].includes(s.key))
          : ORDER_STAGES
        ).map((s, i, arr) => {
          const curIdx = arr.findIndex((x) => x.key === wf.stage);
          const done = i < curIdx;
          const cur = i === curIdx;
          return (
            <span
              key={s.key}
              className={`rounded-full px-2.5 py-1 text-xs ${cur ? "bg-primary text-primary-foreground" : done ? "bg-emerald-600/15 text-emerald-700" : "bg-muted text-muted-foreground"}`}
            >
              {displayStageLabel(s.key)}
            </span>
          );
        })}
      </div>

      {/* Live workflow status — who acts next, visible to everyone. `#pending` is the
          deep-link target for order notifications, so they land on the current action. */}
      <Card id="pending" className={`scroll-mt-24 ${pend ? "border-primary/40 bg-primary/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
        <CardContent className="py-3">
          {pend ? (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm">
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">{stagePhase(wf.stage)} · Waiting for</span>
                <div className="font-medium">{pend.action}</div>
              </div>
              <div className="text-right">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Approver{pendingApprovers.length > 1 ? "s" : ""}</span>
                <div className="font-medium">{pendingApprovers.length ? pendingApprovers.join(" · ") : "—"}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm font-medium text-emerald-700">Order closed — all steps complete.</div>
          )}
        </CardContent>
      </Card>

      {/* Phase 1 — approvals */}
      <Card id="phase-1" className="scroll-mt-24">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 1 · Order intake &amp; payment clearing</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {docCheck ? <span className="text-emerald-600">✓</span> : <span className="text-muted-foreground">○</span>}
            <span>Documents checked{docCheck ? ` — ${withDesig(docCheck.byName, designationOf("doc_check"))}, ${fmtWhen(docCheck.at)}` : ""}</span>
          </div>
          <div className="flex items-center gap-2">
            {payCleared ? <span className="text-emerald-600">✓</span> : <span className="text-muted-foreground">○</span>}
            <span>{boughtInOnly ? "Payment cleared & PO creation" : stockOnly ? "Payment cleared & stock release" : "Payment cleared & job orders released"}{payCleared ? ` — ${withDesig(payCleared.byName, designationOf("payment_cleared"))}, ${fmtWhen(payCleared.at)}` : ""}</span>
          </div>
          {wf.stage === "payment_review" || wf.stage === "docs_checked" ? (
            <p className="pt-1 text-xs text-muted-foreground">Complete these sign-offs from the Orders list.</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Phase 2 — job orders & production */}
      <Card id="phase-2" className="scroll-mt-24">
        <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 2 · Job orders &amp; production</CardTitle></CardHeader>
        <CardContent>
          {/* Fulfilment/handover mode — Delivery / Office pick up / Plant pick up.
              Shown to every role for consistency: interactive for those who may set it
              (admin any time; Sales / Engineer / Payment Approver before the order
              leaves Phase 2), grayed-out (read-only) for everyone else. */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <FulfillmentModeSelector orderId={quote.id} mode={wf.fulfillmentMode} available={availableModes} canSet={canSetMode} />
          </div>
          {wf.stage === "payment_review" || wf.stage === "docs_checked" ? (
            <p className="text-sm text-muted-foreground">Job orders are issued once Phase 1 is complete.</p>
          ) : boughtInOnly && wf.stage === "released" ? (
            <BoughtInProduction
              orderId={quote.id}
              reqRaised={supplierReqRaised}
              poPrepared={supplierPoPrepared}
              purchased={supplierPurchased}
              canNotify={canNotifyBoughtIn}
            />
          ) : stockOnly && wf.stage === "released" ? (
            <StockRelease
              orderId={quote.id}
              lines={stockLines}
              stockItems={stockItems}
              mode={officePickup ? "office_pickup" : plantPick ? "plant_pickup" : "delivery"}
              released={!!wf.approvals.stock_released}
              releasedByName={wf.approvals.stock_released?.byName}
              approved={!!wf.approvals.stock_release_approved}
              approvedByName={wf.approvals.stock_release_approved?.byName}
              canRelease={canReleaseStock}
              canConfirm={canConfirmRelease}
              canNotify={canNotifyRelease}
            />
          ) : (
            <div className="space-y-4">
              <JobOrderManager
                orderId={quote.id}
                stage={wf.stage}
                canIssue={canIssue}
                canReceive={canReceive}
                jobs={jobs}
              />
              {canManageJO && !inProductionOrLater && <AutofillJobOrdersButton orderId={quote.id} />}
              {canSeeDeptJO("fans") && (
              <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/30">
                <div className="mb-2 text-xs font-semibold text-sky-800 dark:text-sky-300">Fans &amp; Blowers job order (Engineer)</div>
                <DeptProductionControls orderId={quote.id} deptKey="fans" {...deptCtrl("fans")} />
                <FansJobOrderPanel
                  orderId={quote.id}
                  jobOrders={wf.fansJobOrders}
                  baseNo={wf.joBaseNo}
                  baseYear={wf.joBaseYear}
                  canManage={canManageJO}
                  canAdd={canManageJO && !inProductionOrLater}
                  admin={adminViewer}
                />
              </div>
              )}
              {canSeeDeptJO("duct") && (
              <div className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
                <div className="mb-2 text-xs font-semibold text-emerald-800 dark:text-emerald-300">Duct job order (Engineer)</div>
                <DeptProductionControls orderId={quote.id} deptKey="duct" {...deptCtrl("duct")} />
                <DuctJobOrderPanel
                  orderId={quote.id}
                  jobOrders={wf.ductJobOrders}
                  baseNo={wf.ductJoBaseNo}
                  baseYear={wf.ductJoBaseYear}
                  canManage={canManageJO}
                  canAdd={canManageJO && !inProductionOrLater}
                  admin={adminViewer}
                />
              </div>
              )}
              {canSeeDeptJO("accessories") && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                <div className="mb-2 text-xs font-semibold text-amber-800 dark:text-amber-300">Accessories job order (Engineer)</div>
                <DeptProductionControls orderId={quote.id} deptKey="accessories" {...deptCtrl("accessories")} />
                <AccessoriesJobOrderPanel
                  orderId={quote.id}
                  jobOrders={wf.accessoriesJobOrders}
                  baseNo={wf.accJoBaseNo}
                  baseYear={wf.accJoBaseYear}
                  canManage={canManageJO}
                  canAdd={canManageJO && !inProductionOrLater}
                  admin={adminViewer}
                />
              </div>
              )}
              {canSeeDeptJO("motor") && (
              <div className="rounded-lg border border-violet-300 bg-violet-50 p-3 dark:border-violet-900 dark:bg-violet-950/30">
                <div className="mb-2 text-xs font-semibold text-violet-800 dark:text-violet-300">Motor controller job order (Engineer)</div>
                <DeptProductionControls orderId={quote.id} deptKey="motor" {...deptCtrl("motor")} />
                <MotorControllerJobOrderPanel
                  orderId={quote.id}
                  jobOrders={wf.motorJobOrders}
                  baseNo={wf.mcJoBaseNo}
                  baseYear={wf.mcJoBaseYear}
                  canManage={canManageJO}
                  canAdd={canManageJO && !inProductionOrLater}
                  admin={adminViewer}
                />
              </div>
              )}
              <div className="border-t pt-3">
                <ConversationLog
                  orderId={quote.id}
                  conversations={wf.conversations}
                  canLog={isSalesViewer}
                  jobOrderRemarks={[
                    ...wf.ductJobOrders.map((d, i) => ({
                      label: wf.ductJoBaseNo != null ? formatDuctJoNumber(wf.ductJoBaseNo, wf.ductJoBaseYear ?? new Date().getFullYear(), i, wf.ductJobOrders.length) : "Duct JO",
                      note: d.note.trim(),
                    })),
                    ...wf.accessoriesJobOrders.map((a, i) => ({
                      label: wf.accJoBaseNo != null ? formatAccessoriesJoNumber(wf.accJoBaseNo, wf.accJoBaseYear ?? new Date().getFullYear(), i, wf.accessoriesJobOrders.length) : "Accessories JO",
                      note: accessoriesJobRemarks(a).trim(),
                    })),
                    ...wf.motorJobOrders.map((m, i) => ({
                      label: wf.mcJoBaseNo != null ? formatMotorControllerJoNumber(wf.mcJoBaseNo, wf.mcJoBaseYear ?? new Date().getFullYear(), i, wf.motorJobOrders.length) : "Motor Controller JO",
                      note: m.note.trim(),
                    })),
                  ].filter((r) => r.note !== "")}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Phase 3 — materials */}
      {showMaterials && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 3 · Materials</CardTitle></CardHeader>
          <CardContent>
            <MaterialRequests orderId={quote.id} requesterName={viewer?.name ?? ""} raisableDepts={raisableDepts} requests={materialReqs} stockItems={stockItems} products={productOptions} showMrfDoc={!hideMrfDoc} admin={adminViewer} canCheckStock={canReleaseMaterials} />
          </CardContent>
        </Card>
      )}

      {/* Phase 3 — purchasing chain (monitoring only; processed in Purchasing) */}
      {(showMaterials || purchaseRows.length > 0) && (
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
            <CardTitle className="text-sm">Phase 4 · Purchasing</CardTitle>
            <Link href="/purchasing" className="text-xs font-medium text-primary hover:underline">Process in Purchasing →</Link>
          </CardHeader>
          <CardContent>
            <PurchasingChain requests={purchaseRows} stockItems={stockItems} orderId={quote.id} poDefaultRemarks={COMPANY.poDefaultRemarks} suppliers={suppliers} paymentTerms={paymentTerms} canManagePO={canManagePO} admin={adminViewer} showAmounts={showAmounts} showSupplier={showSupplier} showStockCheck readOnly />
          </CardContent>
        </Card>
      )}

      {/* Multiple-batch delivery — enabled by an Engineer / Payment Approver /
          admin via the toggle; once on, the entry panel appears so finished items
          can go out in batches while the rest is still being made. */}
      {showBatchToggle && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Deliver in multiple batches?</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              For large orders delivered in parts. Turn this on to send out finished items now — while the rest of the order is still in production — and run each batch through its own payment, quality check and delivery. Enabling is limited to Engineers, the Payment Approver and admins.
            </p>
            <BatchDeliveryToggle orderId={quote.id} enabled={batchEnabled} />
            {showMultiEntry && (
              <div className="border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  Switch this order to multiple-batch delivery. The single-delivery flow won&apos;t be used for this order.
                </p>
                <MultiDeliveryEntry orderId={quote.id} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Multiple-batch PICK UP — office-pickup orders where the client collects in
          several batches. One toggle: the salesperson/admin turns it on; only an
          admin can turn it off. Each batch runs the pickup Phase-5 sequence. */}
      {showPickupMultiToggle && (
        <Card className="border-primary/30">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Pick up in multiple batches?</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              For orders the client collects in parts. Turn this on to release finished items in batches — each batch runs its own payment, quality check, pick up and documents. Once on, only an admin can turn it off.
            </p>
            <MultiBatchPickupToggle orderId={quote.id} enabled={multiMode} admin={adminViewer} canTurnOn={adminViewer || isPreparerViewer} />
          </CardContent>
        </Card>
      )}

      {/* Phase 5 — final payment, quality, delivery & documents (single delivery) */}
      {showFulfillment && !multiMode && (
        <Card id="phase-5" className="scroll-mt-24">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 5 · Final payment, quality, delivery &amp; documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {fTrail.length > 0 && (
              <div className="space-y-0.5 text-xs text-muted-foreground">
                {fTrail.map((s, i) => <div key={i}>{s}</div>)}
              </div>
            )}
            <FulfillmentActions orderId={quote.id} stage={wf.stage} perms={perms} officePickup={officePickup} plantPickup={plantPick} fromStock={stockOnly} boughtIn={boughtInOnly} closeDocs={saleForClose?.docs ?? {}} vatInclusive={quote.vatMode !== "EXCLUSIVE"} zeroRated={quote.vatMode === "ZERO_RATED"} canEditCloseDocs={perms.canFile || isSalesViewer} recordedPayments={restricted ? [] : recordedPayments} admin={adminViewer} approvers={approvers} restricted={restricted} canRecordPayment={!restricted && (adminViewer || perms.canCheckPay || perms.canConfirmPay || viewer?.role === "ENGINEER")} currency={quote.currency} orderAmount={value} amountPaid={collectedTotal(saleForClose)} />
            {!restricted && saleForClose && <SaleDocumentList sale={saleForClose} vatInclusive={quote.vatMode !== "EXCLUSIVE"} zeroRated={quote.vatMode === "ZERO_RATED"} showFinalPayment={stageIndex(wf.stage) >= stageIndex("final_pay_cleared")} />}
          </CardContent>
        </Card>
      )}
      {/* Phase 5 — upcoming placeholder until production is finished. */}
      {!showFulfillment && !multiMode && (
        <Card className="border-dashed opacity-70">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Phase 5 · Final payment, quality, delivery &amp; documents</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Opens once production is finished — final payment, quality check, delivery and closing documents.</p></CardContent>
        </Card>
      )}
      {/* Phase 5 (multiple deliveries) — each batch runs the full delivery sequence. */}
      {multiMode && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">{isPickupMode ? "Phase 5 · Multiple-batch pick up" : "Phase 5 · Multiple-batch delivery"}</CardTitle></CardHeader>
          <CardContent>
            {/* Turn batch mode back off (returns the order to the single flow) —
                allowed while no batch has been opened. For pick up only an admin can
                turn it off; otherwise Engineer / Payment Approver / admin. */}
            {isPickupMode ? (
              adminViewer && (
                <div className="mb-3 rounded-md border bg-muted/20 p-2.5">
                  <MultiBatchPickupToggle orderId={quote.id} enabled admin={adminViewer} canTurnOn hasOpenBatches={mbBatchViews.some((b) => !b.cancelled)} />
                </div>
              )
            ) : (
              canEnableBatch && (
                <div className="mb-3 rounded-md border bg-muted/20 p-2.5">
                  <BatchDeliveryToggle orderId={quote.id} enabled={batchEnabled} multiActive hasOpenBatches={mbBatchViews.some((b) => !b.cancelled)} />
                </div>
              )
            )}
            <p className="mb-3 text-xs text-muted-foreground">
              {isPickupMode
                ? "Pick up the order in batches — open a batch of finished/released items (any items or partial quantities) and run each through the pick-up sequence. Each batch collects its own partial payment (payment first). The order closes once every item is picked up and all batches are filed."
                : "Deliver the order in batches — open a batch of finished items (any items or partial quantities) and run each through the full delivery sequence: notify client → payment → quality → transfer → deliver → documents. Each batch collects its own partial payment (payment first). The order closes once every item is delivered and all batches are filed."}
            </p>
            <MultiBatchPanel orderId={quote.id} officePickup={isPickupMode} plantPickup={plantPick} items={mbItems} batches={restricted ? mbBatchViews.map((b) => ({ ...b, paymentAmount: undefined, paymentProof: null, docs: {} })) : mbBatchViews} payments={restricted ? [] : mbPayments} vatInclusive={quote.vatMode !== "EXCLUSIVE"} zeroRated={quote.vatMode === "ZERO_RATED"} canManage={canManageMulti} canCollect={!restricted && (adminViewer || perms.canCheckPay || perms.canConfirmPay)} currency={quote.currency} orderAmount={restricted ? 0 : value} amountPaid={restricted ? 0 : collectedTotal(saleForClose)} clientName={custName} restricted={restricted} admin={adminViewer} />
          </CardContent>
        </Card>
      )}

      {/* Phase 6 — sales commission (once the order is closed with complete docs).
          Purely financial — hidden from client-restricted (shop-floor) viewers. */}
      {!restricted && phase6Active && commissionInfo && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 6 · Sales commission</CardTitle></CardHeader>
          <CardContent>
            <CommissionFlow
              orderId={quote.id}
              amount={commissionInfo.amount}
              currency={commissionInfo.currency}
              salesMonth={commissionInfo.salesMonth}
              dueLabel={commissionInfo.dueLabel}
              flow={commissionInfo.flow}
              canApprove={perms.canApproveComm}
              canAccounting={perms.canAccountingComm}
              admin={adminViewer}
              approvers={approvers}
            />
          </CardContent>
        </Card>
      )}
      {/* Phase 6 — upcoming placeholder until the order is closed with complete docs. */}
      {!restricted && !phase6Active && (
        <Card className="border-dashed opacity-70">
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Phase 6 · Sales commission</CardTitle></CardHeader>
          <CardContent><p className="text-sm text-muted-foreground">Opens once the client has fully paid and the order is closed with all closing documents complete — the sales commission voucher, approval and release.</p></CardContent>
        </Card>
      )}

      {/* Admin-only: roll back the workflow / an approver's approval */}
      {adminViewer && (
        <Card className="border-destructive/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-destructive">Admin override</CardTitle>
          </CardHeader>
          <CardContent>
            <AdminWorkflowOverride orderId={quote.id} priorStages={priorStages} approvals={rollbackApprovals} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
