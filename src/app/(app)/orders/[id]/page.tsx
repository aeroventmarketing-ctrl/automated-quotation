import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { payableTotal } from "@/lib/quote";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import {
  readOrderWorkflow,
  ORDER_STAGES,
  PRODUCTION_DEPTS,
  deptRole,
  stageLabel,
  type OrderStage,
} from "@/lib/order-workflow";
import { JobOrderManager } from "./job-order-manager";

export const dynamic = "force-dynamic";

const STAGE_VARIANT: Record<OrderStage, "secondary" | "warning" | "success"> = {
  payment_review: "secondary",
  docs_checked: "warning",
  released: "success",
  in_production: "warning",
  production_finished: "success",
};

const fmtWhen = (iso?: string) => (iso ? formatDate(new Date(iso)) : "");

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [quote, viewer, assignments] = await Promise.all([
    prisma.quotation.findUnique({
      where: { id },
      include: { inquiry: { include: { customer: true } }, preparedBy: true },
    }),
    getCurrentUser(),
    getWorkflowRoles(),
  ]);
  if (!quote) notFound();

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
    </div>
  );
}
