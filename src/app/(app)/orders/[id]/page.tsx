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
  PRODUCTION_DEPTS,
  deptRole,
  deptLabel,
  stageLabel,
  stagePhase,
  pendingStep,
  type OrderStage,
} from "@/lib/order-workflow";
import { purchaseStepsFrom, PR_STATUS_LABEL, type PRStatus } from "@/lib/purchasing";
import { coercePurchaseOrder, poLineFromPRItem } from "@/lib/purchase-order";
import { getSuppliers } from "@/lib/suppliers";
import { COMPANY } from "@/lib/config";
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

const fmtWhen = (iso?: string) => (iso ? formatDateTime(iso) : "");

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [quote, viewer, assignments, purchaseRequests, stockItemsRaw, allUsers, suppliers] = await Promise.all([
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
  ]);
  if (!quote) notFound();
  const stockItems = stockItemsRaw;

  const adminViewer = isAdmin(viewer);
  const wf = readOrderWorkflow(quote.classification);
  const value = payableTotal(quote);

  // Resolve workflow roles → the people who hold them, so every viewer can see
  // who the current approver is.
  const userName = new Map(allUsers.map((u) => [u.id, u.name] as const));
  const namesForRole = (role: WorkflowRoleKey): string[] =>
    usersWithWorkflowRole(assignments, role).map((uid) => userName.get(uid)).filter((n): n is string => !!n);
  const approverLabel = (role: WorkflowRoleKey): string => {
    const names = namesForRole(role);
    return `${workflowRoleLabel(role)}${names.length ? ` — ${names.join(", ")}` : " (unassigned)"}`;
  };

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

  const jobs = PRODUCTION_DEPTS.filter((d) => wf.jobOrders[d.key]).map((d) => {
    const jo = wf.jobOrders[d.key]!;
    const nextTo: "in_production" | "finished" | null =
      jo.status === "issued" ? "in_production" : jo.status === "in_production" ? "finished" : null;
    const nextLabel = nextTo === "in_production" ? "Start production" : nextTo === "finished" ? "Mark finished" : null;
    const canAdvance =
      nextTo != null &&
      wf.stage === "in_production" &&
      (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, deptRole(d.key) as WorkflowRoleKey)));
    const events: { label: string; who: string; when: string }[] = [];
    if (jo.issuedByName) events.push({ label: "Issued", who: jo.issuedByName, when: fmtWhen(jo.issuedAt) });
    if (jo.startedByName) events.push({ label: "Started", who: jo.startedByName, when: fmtWhen(jo.startedAt) });
    if (jo.finishedByName) events.push({ label: "Finished", who: jo.finishedByName, when: fmtWhen(jo.finishedAt) });
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
    canPrepDocs: hasRole("accounting"),
    canDeliver: hasRole("logistics"),
    canFile: hasRole("accounting"),
  };
  const A = wf.approvals;
  const fStamp = (label: string, a?: { byName: string; at: string }) =>
    a ? `${label} — ${a.byName} · ${fmtWhen(a.at)}` : null;
  const fTrail: string[] = [
    fStamp("Client notified", A.client_notified),
    fStamp("Final payment checked", A.final_pay_checked),
    fStamp("Final payment confirmed", A.final_pay_confirmed),
    fStamp("Delivery approved", A.delivery_approved),
    fStamp("Delivered", A.delivered),
    fStamp("Documents filed", A.documents_filed),
  ].filter((s): s is string => s !== null);
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
    date: m.raisedAt ? formatDateTime(m.raisedAt) : "",
    handledByName: m.handledByName,
    handledWhen: m.handledAt ? formatDateTime(m.handledAt) : "",
    canHandle: canWarehouse && m.status === "requested",
  }));
  const showMaterials = wf.stage === "in_production" || wf.stage === "production_finished";

  // Purchasing chain (Phase 3, part 2) — real PurchaseRequest rows.
  const prVariant = (s: PRStatus): "secondary" | "warning" | "success" | "destructive" =>
    s === "PENDING_APPROVAL" ? "secondary" : s === "REJECTED" ? "destructive" : s === "COMPLETED" ? "success" : "warning";
  const canManagePO =
    adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "purchaser" as WorkflowRoleKey));
  const pStamp = (label: string, who?: string | null, at?: Date | null) =>
    who ? `${label} — ${who} · ${formatDateTime(at ?? undefined)}` : null;
  const purchaseRows = purchaseRequests.map((pr) => {
    const status = pr.status as PRStatus;
    const prItems = Array.isArray(pr.items) ? (pr.items as string[]) : [];
    const trail: string[] = [
      pStamp("Requested", pr.createdByName, pr.createdAt),
      pStamp(status === "REJECTED" ? "Rejected" : "Approved", pr.decidedByName, pr.decidedAt),
      pStamp("Voucher & check", pr.voucherByName, pr.voucherAt),
      pStamp("Purchased", pr.purchasedByName, pr.purchasedAt),
      pStamp("Checked", pr.checkedByName, pr.checkedAt),
      pStamp("Received", pr.receivedByName, pr.receivedAt),
      pStamp("Plant Manager approved", pr.plantApprovedByName, pr.plantApprovedAt),
    ].filter((s): s is string => s !== null);
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
            <PurchasingChain requests={purchaseRows} stockItems={stockItems} orderId={quote.id} poDefaultRemarks={COMPANY.poDefaultRemarks} suppliers={suppliers} />
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
