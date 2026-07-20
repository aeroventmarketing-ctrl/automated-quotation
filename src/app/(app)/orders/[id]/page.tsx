import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { payableTotal } from "@/lib/quote";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
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
} from "@/lib/order-workflow";
import { purchaseStepsFrom, PR_STATUS_LABEL, type PRStatus } from "@/lib/purchasing";
import { buildPurchaseTrail, buildReturnViews, buildReconcileView } from "@/lib/purchase-chain-row";
import { coercePurchaseOrder, poLineFromPRItem } from "@/lib/purchase-order";
import { getSuppliers } from "@/lib/suppliers";
import { getProducts } from "@/lib/product-catalog";
import { getPaymentTerms } from "@/lib/payment-terms";
import { getHideOrderProgress, progressHiddenFor } from "@/lib/order-progress-visibility";
import { saleFromClassification, closeDocsState, PAYMENT_KIND_LABEL } from "@/lib/sale";
import { COMPANY } from "@/lib/config";
import { JobOrderManager } from "./job-order-manager";
import { FansJobOrderPanel } from "./fans-job-order-panel";
import { ConversationLog } from "./conversation-log";
import { AdminWorkflowOverride } from "./admin-workflow-override";
import { MaterialRequests } from "./material-requests";
import { PurchasingChain } from "./purchasing-chain";
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
      include: { inquiry: { include: { customer: true } }, preparedBy: true },
    }),
    getCurrentUser(),
    getWorkflowRoles(),
    prisma.purchaseRequest.findMany({ where: { quotationId: id }, orderBy: { createdAt: "asc" } }),
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }).catch(() => []),
    prisma.user.findMany({ select: { id: true, name: true } }),
    getSuppliers().catch(() => []),
    getPaymentTerms().catch(() => []),
    getHideOrderProgress().catch(() => false),
  ]);
  if (!quote) notFound();
  const stockItems = stockItemsRaw;
  // Catalogue of purchasable products (for the MRF autocomplete); may be empty
  // before the product table is migrated.
  const productOptions = await getProducts().then((ps) => ps.map((p) => ({ id: p.id, sku: p.sku, name: p.name, unit: p.unit }))).catch(() => []);
  // Sales commission (exists once the order is closed) — for the post-close
  // commission sign-offs and the "issued 15 days after the sales month" due date.
  const commissionRow = await prisma.commission.findUnique({ where: { quotationId: id } }).catch(() => null);

  const adminViewer = isAdmin(viewer);
  const wf = readOrderWorkflow(quote.classification);
  // Sale record (PO, payments, closing documents) — the closing docs reflect
  // between the quotation Sale panel and this order's close step.
  const saleForClose = saleFromClassification(quote.classification);
  const value = payableTotal(quote);

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
          <h1 className="text-2xl font-bold">{quote.inquiry.customer.company}</h1>
          <p className="text-sm text-muted-foreground">
            Order{" "}
            <Link href={`/quotations/${quote.id}`} className="text-primary hover:underline">{quote.quoteNumber}</Link>
            {(quote.projectName || quote.inquiry.projectName) && ` · ${quote.projectName ?? quote.inquiry.projectName}`}
            {" · "}
            {formatCurrency(value, quote.currency)}
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

  // Live "who acts next" for the whole order.
  const pend = pendingStep(wf);
  const pendingApprovers: string[] = pend
    ? pend.sales
      ? [`Sales${quote.preparedBy?.name ? ` — ${quote.preparedBy.name}` : ""}`]
      : pend.roles.length
        ? pend.roles.map(approverLabel)
        : []
    : [];

  const canIssue =
    wf.stage === "released" &&
    (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "technical_head" as WorkflowRoleKey)));

  // The Plant Manager receives the released job orders before production begins.
  const canReceive =
    wf.stage === "in_production" &&
    (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "plant_manager" as WorkflowRoleKey)));

  // Admin rollback: earlier stages to return to + the sign-offs on record.
  const curStageIdx = stageIndex(wf.stage);
  const priorStages = ORDER_STAGES.filter((_, i) => i < curStageIdx).map((s) => ({ key: s.key, label: s.label }));
  const rollbackApprovals = Object.entries(wf.approvals)
    .filter(([k]) => APPROVAL_STEPS[k])
    .map(([k, a]) => ({ key: k, label: APPROVAL_STEPS[k].label, byName: a.byName, at: fmtWhen(a.at) }))
    .sort((x, y) => stageIndex(APPROVAL_STEPS[x.key].to) - stageIndex(APPROVAL_STEPS[y.key].to));

  // The Engineer (or admin) makes the Fans & Blowers job order. New job orders
  // can no longer be added once the order is In Production (or later).
  const canManageJO = adminViewer || viewer?.role === "ENGINEER";
  const inProductionOrLater = stageIndex(wf.stage) >= stageIndex("producing");

  const jobs = PRODUCTION_DEPTS.filter((d) => wf.jobOrders[d.key]).map((d) => {
    const jo = wf.jobOrders[d.key]!;
    const nextTo: "in_production" | "finished" | null =
      jo.status === "issued" ? "in_production" : jo.status === "in_production" ? "finished" : null;
    const nextLabel = nextTo === "in_production" ? "Start production" : nextTo === "finished" ? "Mark finished" : null;
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
    return {
      key: d.key,
      label: d.label,
      status: jo.status,
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
  const perms = {
    canNotify: isSalesViewer,
    canCheckPay: hasRole("accounting"),
    canConfirmPay: hasRole("payment_approver"),
    canQaTest: hasRole("technical_head") || hasRole("quality_inspector"),
    canQaPlant: hasRole("plant_manager"),
    canQaTransfer: hasRole("logistics"),
    canQaSales: isSalesViewer,
    canPrepDocs: hasRole("accounting"),
    canDeliver: hasRole("logistics"),
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
    fStamp("Transferred to office", "qa_transferred", A.qa_transferred),
    fStamp("Sales 2nd QC & quantity passed", "qa_sales_checked", A.qa_sales_checked),
    fStamp("Delivery approved", "delivery_approved", A.delivery_approved),
    fStamp("Delivered", "delivered", A.delivered),
    fStamp("Delivery confirmed", "delivery_confirmed", A.delivery_confirmed),
    fStamp("Documents surrendered", "docs_surrendered", A.docs_surrendered),
    fStamp("Documents received", "docs_received", A.docs_received),
    fStamp("Documents filed", "documents_filed", A.documents_filed),
  ].filter((s): s is string => s !== null);
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

  // Materials (Phase 3, part 1): raise MRFs (dept head, during production) and
  // warehouse issue/escalate.
  const canWarehouse =
    adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "warehouse" as WorkflowRoleKey));
  // A department can raise its MRF only once its job order is actually in
  // production (the head pressed "Start production" — status left "issued").
  const raisableDepts =
    wf.stage === "jo_received" || wf.stage === "producing"
      ? PRODUCTION_DEPTS.filter(
          (d) =>
            wf.jobOrders[d.key]?.status === "in_production" &&
            (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(d.key) as WorkflowRoleKey))),
        ).map((d) => ({ key: d.key, label: d.label }))
      : [];
  // Link each MRF to the purchase request it was escalated into, so the MRF card
  // reflects the live purchasing-chain stage (approved → voucher → purchased → …).
  const prByMrf = new Map<string, (typeof purchaseRequests)[number]>();
  for (const pr of purchaseRequests) if (pr.mrfId) prByMrf.set(pr.mrfId, pr);
  const prBadge = (s: PRStatus): "secondary" | "warning" | "success" | "destructive" =>
    s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" || s === "CANCELLED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";
  const materialReqs = wf.materialRequests.map((m) => {
    const linkedPr = prByMrf.get(m.id);
    const poStatus = linkedPr ? (linkedPr.status as PRStatus) : null;
    return {
      id: m.id,
      formNo: m.formNo,
      orderId: quote.id,
      deptLabel: deptLabel(m.dept),
      items: m.items,
      note: m.note,
      status: m.status,
      poStatusLabel: poStatus ? PR_STATUS_LABEL[poStatus] : null,
      poStatusVariant: poStatus ? prBadge(poStatus) : null,
      raisedByName: m.raisedByName,
      date: m.raisedAt ? formatDateTime(m.raisedAt) : "",
      handledByName: m.handledByName,
      handledWhen: m.handledAt ? formatDateTime(m.handledAt) : "",
      canHandle: canWarehouse && m.status === "requested",
      // The requesting department head (or an admin) can withdraw it before the
      // warehouse handles it.
      canCancel:
        m.status === "requested" &&
        (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(m.dept) as WorkflowRoleKey))),
    };
  });
  // Phase 3 (Materials + Purchasing) opens only once production has actually
  // started — a production head pressed "Start production" on a received job
  // order (per-JO status leaves "issued"). It stays visible afterwards.
  const productionStarted = PRODUCTION_DEPTS.some((d) => {
    const s = wf.jobOrders[d.key]?.status;
    return s === "in_production" || s === "finished";
  });
  const showMaterials = productionStarted || wf.stage === "production_finished";

  // Purchasing chain (Phase 3, part 2) — real PurchaseRequest rows.
  const prVariant = (s: PRStatus): "secondary" | "warning" | "success" | "destructive" =>
    s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";
  const canManagePO =
    adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "purchaser" as WorkflowRoleKey));
  const mrfNoById = new Map(wf.materialRequests.map((m) => [m.id, m.formNo]));
  const purchaseRows = purchaseRequests.map((pr) => {
    const status = pr.status as PRStatus;
    const prItems = Array.isArray(pr.items) ? (pr.items as string[]) : [];
    const trail = buildPurchaseTrail(pr);
    const actions = purchaseStepsFrom(status).map((step) => {
      const names = namesForRole(step.role);
      return {
        key: step.key,
        label: step.label,
        roleLabel: `${workflowRoleLabel(step.role)}${names.length ? ` (${names.join(", ")})` : ""}`,
        canAct: adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, step.role)),
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
      poDefaultLines: prItems.map(poLineFromPRItem),
      canManagePO,
      returns: buildReturnViews(pr),
      canRaiseReturn: false,
      canResolveReturn: false,
      reconcile: buildReconcileView(pr),
      canRecordReconcile: false,
      canSettleReconcile: false,
    };
  });

  return (
    <div className="space-y-5">
      <AutoRefresh />
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Orders
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{quote.inquiry.customer.company}</h1>
          <p className="text-sm text-muted-foreground">
            Order{" "}
            <Link href={`/quotations/${quote.id}`} className="text-primary hover:underline">{quote.quoteNumber}</Link>
            {(quote.projectName || quote.inquiry.projectName) && ` · ${quote.projectName ?? quote.inquiry.projectName}`}
            {" · "}
            {formatCurrency(value, quote.currency)}
          </p>
        </div>
        <Badge variant={STAGE_VARIANT[wf.stage]} className="text-sm">{stageLabel(wf.stage)}</Badge>
      </div>

      {/* Stage progress */}
      <div className="flex flex-wrap gap-1.5">
        {ORDER_STAGES.map((s, i) => {
          const curIdx = ORDER_STAGES.findIndex((x) => x.key === wf.stage);
          const done = i < curIdx;
          const cur = i === curIdx;
          return (
            <span
              key={s.key}
              className={`rounded-full px-2.5 py-1 text-xs ${cur ? "bg-primary text-primary-foreground" : done ? "bg-emerald-600/15 text-emerald-700" : "bg-muted text-muted-foreground"}`}
            >
              {s.label}
            </span>
          );
        })}
      </div>

      {/* Live workflow status — who acts next, visible to everyone */}
      <Card className={pend ? "border-primary/40 bg-primary/5" : "border-emerald-500/40 bg-emerald-500/5"}>
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
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 1 · Order intake &amp; payment clearing</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {docCheck ? <span className="text-emerald-600">✓</span> : <span className="text-muted-foreground">○</span>}
            <span>Documents checked{docCheck ? ` — ${withDesig(docCheck.byName, designationOf("doc_check"))}, ${fmtWhen(docCheck.at)}` : ""}</span>
          </div>
          <div className="flex items-center gap-2">
            {payCleared ? <span className="text-emerald-600">✓</span> : <span className="text-muted-foreground">○</span>}
            <span>Payment cleared &amp; job orders released{payCleared ? ` — ${withDesig(payCleared.byName, designationOf("payment_cleared"))}, ${fmtWhen(payCleared.at)}` : ""}</span>
          </div>
          {wf.stage === "payment_review" || wf.stage === "docs_checked" ? (
            <p className="pt-1 text-xs text-muted-foreground">Complete these sign-offs from the Orders list.</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Phase 2 — job orders & production */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 2 · Job orders &amp; production</CardTitle></CardHeader>
        <CardContent>
          {wf.stage === "payment_review" || wf.stage === "docs_checked" ? (
            <p className="text-sm text-muted-foreground">Job orders are issued once Phase 1 is complete.</p>
          ) : (
            <div className="space-y-4">
              <JobOrderManager
                orderId={quote.id}
                stage={wf.stage}
                canIssue={canIssue}
                canReceive={canReceive}
                allDepts={PRODUCTION_DEPTS.map((d) => ({ key: d.key, label: d.label }))}
                jobs={jobs}
              />
              <div className="border-t pt-3">
                <div className="mb-2 text-xs font-semibold text-muted-foreground">Fans &amp; Blowers job order (Engineer)</div>
                <FansJobOrderPanel
                  orderId={quote.id}
                  jobOrders={wf.fansJobOrders}
                  baseNo={wf.joBaseNo}
                  baseYear={wf.joBaseYear}
                  canManage={canManageJO}
                  canAdd={canManageJO && !inProductionOrLater}
                />
              </div>
              <div className="border-t pt-3">
                <ConversationLog orderId={quote.id} conversations={wf.conversations} canLog={isSalesViewer} />
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
            <MaterialRequests orderId={quote.id} requesterName={viewer?.name ?? ""} raisableDepts={raisableDepts} requests={materialReqs} stockItems={stockItems} products={productOptions} />
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
            <PurchasingChain requests={purchaseRows} stockItems={stockItems} orderId={quote.id} poDefaultRemarks={COMPANY.poDefaultRemarks} suppliers={suppliers} paymentTerms={paymentTerms} canManagePO={canManagePO} readOnly />
          </CardContent>
        </Card>
      )}

      {/* Phase 5 — final payment, quality, delivery & documents */}
      {showFulfillment && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 5 · Final payment, quality, delivery &amp; documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {fTrail.length > 0 && (
              <div className="space-y-0.5 text-xs text-muted-foreground">
                {fTrail.map((s, i) => <div key={i}>{s}</div>)}
              </div>
            )}
            <FulfillmentActions orderId={quote.id} stage={wf.stage} perms={perms} closeDocs={saleForClose?.docs ?? {}} vatInclusive={quote.vatMode === "INCLUSIVE"} canEditCloseDocs={perms.canFile || isSalesViewer} recordedPayments={recordedPayments} />
            {saleForClose && <SaleDocumentList sale={saleForClose} vatInclusive={quote.vatMode === "INCLUSIVE"} showFinalPayment={stageIndex(wf.stage) >= stageIndex("final_pay_cleared")} />}
          </CardContent>
        </Card>
      )}

      {/* Phase 6 — sales commission (once the order is closed with complete docs) */}
      {wf.stage === "closed" && commissionInfo && closeDocsState(saleForClose?.docs, quote.vatMode === "INCLUSIVE").complete && (
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
            />
          </CardContent>
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
