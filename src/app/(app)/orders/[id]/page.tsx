import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { payableTotal } from "@/lib/quote";
import { getWorkflowRoles, userHasWorkflowRole, workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import {
  readOrderWorkflow,
  ORDER_STAGES,
  PRODUCTION_DEPTS,
  deptRole,
  deptLabel,
  stageLabel,
  type OrderStage,
} from "@/lib/order-workflow";
import { purchaseStepsFrom, PR_STATUS_LABEL, type PRStatus } from "@/lib/purchasing";
import { JobOrderManager } from "./job-order-manager";
import { MaterialRequests } from "./material-requests";
import { PurchasingChain } from "./purchasing-chain";
import { FulfillmentActions } from "./fulfillment-actions";

export const dynamic = "force-dynamic";

const STAGE_VARIANT: Record<OrderStage, "secondary" | "warning" | "success"> = {
  payment_review: "secondary",
  docs_checked: "warning",
  released: "success",
  in_production: "warning",
  production_finished: "success",
  final_pay_review: "secondary",
  final_pay_checked: "warning",
  final_pay_cleared: "warning",
  delivery_docs_ready: "warning",
  delivered: "warning",
  closed: "success",
};

const fmtWhen = (iso?: string) => (iso ? formatDate(new Date(iso)) : "");

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [quote, viewer, assignments, purchaseRequests, stockItemsRaw] = await Promise.all([
    prisma.quotation.findUnique({
      where: { id },
      include: { inquiry: { include: { customer: true } }, preparedBy: true },
    }),
    getCurrentUser(),
    getWorkflowRoles(),
    prisma.purchaseRequest.findMany({ where: { quotationId: id }, orderBy: { createdAt: "asc" } }),
    prisma.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true } }).catch(() => []),
  ]);
  if (!quote) notFound();
  const stockItems = stockItemsRaw;

  const adminViewer = isAdmin(viewer);
  const wf = readOrderWorkflow(quote.classification);
  const value = payableTotal(quote);

  const canIssue =
    wf.stage === "released" &&
    (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "technical_head" as WorkflowRoleKey)));

  const jobs = PRODUCTION_DEPTS.filter((d) => wf.jobOrders[d.key]).map((d) => {
    const jo = wf.jobOrders[d.key]!;
    const nextTo: "in_production" | "finished" | null =
      jo.status === "issued" ? "in_production" : jo.status === "in_production" ? "finished" : null;
    const nextLabel = nextTo === "in_production" ? "Start production" : nextTo === "finished" ? "Mark finished" : null;
    const canAdvance =
      nextTo != null &&
      wf.stage === "in_production" &&
      (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(d.key) as WorkflowRoleKey)));
    return {
      key: d.key,
      label: d.label,
      status: jo.status,
      issuedByName: jo.issuedByName,
      startedByName: jo.startedByName,
      finishedByName: jo.finishedByName,
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
    canPrepDocs: hasRole("accounting"),
    canDeliver: hasRole("logistics"),
    canFile: hasRole("accounting"),
  };
  const A = wf.approvals;
  const fTrail: string[] = [];
  if (A.client_notified) fTrail.push(`Client notified — ${A.client_notified.byName}`);
  if (A.final_pay_checked) fTrail.push(`Final payment checked — ${A.final_pay_checked.byName}`);
  if (A.final_pay_confirmed) fTrail.push(`Final payment confirmed — ${A.final_pay_confirmed.byName}`);
  if (A.delivery_approved) fTrail.push(`Delivery approved — ${A.delivery_approved.byName}`);
  if (A.delivered) fTrail.push(`Delivered — ${A.delivered.byName}`);
  if (A.documents_filed) fTrail.push(`Documents filed — ${A.documents_filed.byName}`);
  const fulfillmentStages = new Set([
    "production_finished", "final_pay_review", "final_pay_checked", "final_pay_cleared",
    "delivery_docs_ready", "delivered", "closed",
  ]);
  const showFulfillment = fulfillmentStages.has(wf.stage);

  // Materials (Phase 3, part 1): raise MRFs (dept head, during production) and
  // warehouse issue/escalate.
  const canWarehouse =
    adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "warehouse" as WorkflowRoleKey));
  const raisableDepts =
    wf.stage === "in_production"
      ? PRODUCTION_DEPTS.filter(
          (d) =>
            wf.jobOrders[d.key] &&
            (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(d.key) as WorkflowRoleKey))),
        ).map((d) => ({ key: d.key, label: d.label }))
      : [];
  const materialReqs = wf.materialRequests.map((m) => ({
    id: m.id,
    formNo: m.formNo,
    orderId: quote.id,
    deptLabel: deptLabel(m.dept),
    items: m.items,
    note: m.note,
    status: m.status,
    raisedByName: m.raisedByName,
    date: m.raisedAt ? formatDate(new Date(m.raisedAt)) : "",
    handledByName: m.handledByName,
    canHandle: canWarehouse && m.status === "requested",
  }));
  const showMaterials = wf.stage === "in_production" || wf.stage === "production_finished";

  // Purchasing chain (Phase 3, part 2) — real PurchaseRequest rows.
  const prVariant = (s: PRStatus): "secondary" | "warning" | "success" | "destructive" =>
    s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";
  const purchaseRows = purchaseRequests.map((pr) => {
    const status = pr.status as PRStatus;
    const trail: string[] = [];
    if (pr.decidedByName) trail.push(`${status === "REJECTED" ? "Rejected" : "Approved"} by ${pr.decidedByName}`);
    if (pr.voucherByName) trail.push(`Voucher by ${pr.voucherByName}`);
    if (pr.purchasedByName) trail.push(`Bought by ${pr.purchasedByName}`);
    if (pr.checkedByName) trail.push(`Checked by ${pr.checkedByName}`);
    if (pr.receivedByName) trail.push(`Received by ${pr.receivedByName}`);
    if (pr.plantApprovedByName) trail.push(`Plant Mgr ${pr.plantApprovedByName}`);
    const actions = purchaseStepsFrom(status).map((step) => ({
      key: step.key,
      label: step.label,
      roleLabel: workflowRoleLabel(step.role),
      canAct: adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, step.role)),
    }));
    return {
      id: pr.id,
      deptLabel: deptLabel(pr.dept as typeof PRODUCTION_DEPTS[number]["key"]),
      items: Array.isArray(pr.items) ? (pr.items as string[]) : [],
      note: pr.note,
      status,
      statusLabel: PR_STATUS_LABEL[status],
      variant: prVariant(status),
      trail,
      actions,
    };
  });

  return (
    <div className="space-y-5">
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

      {/* Phase 1 — approvals */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 1 · Order intake &amp; payment clearing</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            {docCheck ? <span className="text-emerald-600">✓</span> : <span className="text-muted-foreground">○</span>}
            <span>Documents checked{docCheck ? ` — ${docCheck.byName}, ${fmtWhen(docCheck.at)}` : ""}</span>
          </div>
          <div className="flex items-center gap-2">
            {payCleared ? <span className="text-emerald-600">✓</span> : <span className="text-muted-foreground">○</span>}
            <span>Payment cleared &amp; job orders released{payCleared ? ` — ${payCleared.byName}, ${fmtWhen(payCleared.at)}` : ""}</span>
          </div>
          {wf.stage === "payment_review" || wf.stage === "docs_checked" ? (
            <p className="pt-1 text-xs text-muted-foreground">Complete these sign-offs from the Orders list.</p>
          ) : null}
        </CardContent>
      </Card>

      {/* Phase 2 / 4 — job orders & production */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Job orders &amp; production</CardTitle></CardHeader>
        <CardContent>
          {wf.stage === "payment_review" || wf.stage === "docs_checked" ? (
            <p className="text-sm text-muted-foreground">Job orders are issued once Phase 1 is complete.</p>
          ) : (
            <JobOrderManager
              orderId={quote.id}
              stage={wf.stage}
              canIssue={canIssue}
              allDepts={PRODUCTION_DEPTS.map((d) => ({ key: d.key, label: d.label }))}
              jobs={jobs}
            />
          )}
        </CardContent>
      </Card>

      {/* Phase 3 — materials */}
      {showMaterials && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 3 · Materials</CardTitle></CardHeader>
          <CardContent>
            <MaterialRequests orderId={quote.id} requesterName={viewer?.name ?? ""} raisableDepts={raisableDepts} requests={materialReqs} stockItems={stockItems} />
          </CardContent>
        </Card>
      )}

      {/* Phase 3 — purchasing chain (real records) */}
      {(showMaterials || purchaseRows.length > 0) && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 3 · Purchasing</CardTitle></CardHeader>
          <CardContent>
            <PurchasingChain requests={purchaseRows} stockItems={stockItems} />
          </CardContent>
        </Card>
      )}

      {/* Phase 5 & 6 — delivery & closeout */}
      {showFulfillment && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Phase 5 &amp; 6 · Final payment, delivery &amp; documents</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {fTrail.length > 0 && <div className="text-xs text-muted-foreground">{fTrail.join(" · ")}</div>}
            <FulfillmentActions orderId={quote.id} stage={wf.stage} perms={perms} documents={wf.documents} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
