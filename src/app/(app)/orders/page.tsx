import { prisma } from "@/lib/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { payableTotal, round2 } from "@/lib/quote";
import {
  saleFromClassification,
  isSaleConfirmed,
  collectedTotal,
  docCheckMissing,
  ARRANGEMENT_LABEL,
  type SaleRecord,
} from "@/lib/sale";
import { getWorkflowRoles, userHasWorkflowRole, workflowRoleLabel } from "@/lib/workflow-roles";
import { getApproverDirectory } from "@/lib/approver-directory";
import { readOrderWorkflow, nextOrderStep, stageLabel, pendingStep, ORDER_STAGES, PRODUCTION_DEPTS, deptLabel, type OrderStage } from "@/lib/order-workflow";
import { getHideOrderProgress, progressHiddenFor } from "@/lib/order-progress-visibility";
import { getDocCheckGateEnabled } from "@/lib/doc-check-gate";
import { isClientRestricted, CLIENT_HIDDEN } from "@/lib/client-visibility";
import { OrdersTable } from "./orders-table";

export const dynamic = "force-dynamic";

/** Best-known order date: when confirmed, else earliest payment, else PO upload. */
function orderDate(sale: SaleRecord, fallback: Date): Date {
  const parse = (s?: string | null) => (s ? new Date(s) : null);
  const paymentDates = (sale.payments ?? [])
    .map((p) => parse(p.date))
    .filter((d): d is Date => d != null)
    .sort((a, b) => a.getTime() - b.getTime());
  return parse(sale.soldAt) ?? paymentDates[0] ?? parse(sale.po?.uploadedAt) ?? fallback;
}

/**
 * Orders ledger — every confirmed sale (a quote with a PO and, unless on terms, a
 * payment) shown as an order with its value, what's been collected, and the
 * outstanding balance. Read-only view over the sale data already captured on each
 * quotation; VAT invoice generation follows in the next increment.
 */
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ stage?: string; dept?: string }> }) {
  const sp = await searchParams;
  const stageParam = sp.stage && ORDER_STAGES.some((s) => s.key === sp.stage) ? (sp.stage as OrderStage) : undefined;
  const deptParam = sp.dept && PRODUCTION_DEPTS.some((d) => d.key === sp.dept) ? sp.dept : undefined;

  const [quotes, viewer, assignments, hideOrderProgress, docCheckGate] = await Promise.all([
    prisma.quotation.findMany({
      where: { inquiry: { status: "WON" } },
      include: { inquiry: { include: { customer: true } }, preparedBy: true },
      orderBy: { createdAt: "desc" },
    }),
    getCurrentUser(),
    getWorkflowRoles(),
    getHideOrderProgress().catch(() => false),
    getDocCheckGateEnabled().catch(() => true),
  ]);
  const approverDir = await getApproverDirectory();
  const adminViewer = isAdmin(viewer);
  const progressHidden = progressHiddenFor(hideOrderProgress, viewer, adminViewer, assignments);
  const restricted = await isClientRestricted(viewer, assignments);

  const orders = quotes
    .map((q) => {
      const sale = saleFromClassification(q.classification);
      if (!sale || !isSaleConfirmed(sale)) return null;
      const value = payableTotal(q);
      const collected = collectedTotal(sale);
      const balance = round2(value - collected);
      const status = collected <= 0 ? "PO received" : balance <= 0.005 ? "Paid" : "Partial";

      const wf = readOrderWorkflow(q.classification);
      const next = nextOrderStep(wf.stage);
      const canAct = next != null && (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, next.requiredRole)));
      // "Mark documents checked" is blocked until the required docs are attached.
      const docMissing = docCheckGate && next?.key === "doc_check" ? docCheckMissing(sale) : [];
      const blockedReason = docMissing.length ? `Attach: ${docMissing.join(", ")}` : null;
      // Who acts next across the whole order (all phases), for the "Awaiting" hint.
      const pend = pendingStep(wf);
      const awaitingAll = pend
        ? pend.sales
          ? "Sales"
          : pend.roles.length
            ? pend.roles.map(workflowRoleLabel).join(", ")
            : null
        : null;
      // The people currently assigned to the pending role(s) — named + blinking.
      const awaitingNames = pend && !pend.sales
        ? [...new Set(pend.roles.flatMap((r) => approverDir.namesFor(r)))]
        : [];

      // Departments with an active (unfinished) job order — for the dept filter.
      const inProd = wf.stage === "in_production" || wf.stage === "jo_received" || wf.stage === "producing";
      const prodDepts = inProd
        ? PRODUCTION_DEPTS.filter((pd) => { const jo = wf.jobOrders[pd.key]; return jo && jo.status !== "finished"; }).map((pd) => pd.key)
        : [];

      const d = orderDate(sale, q.createdAt);
      return {
        id: q.id,
        quoteNumber: q.quoteNumber,
        // Restricted (shop-floor) viewers never receive client identity or amounts.
        company: restricted ? CLIENT_HIDDEN : q.inquiry.customer.company,
        customerId: restricted ? "" : q.inquiry.customer.id,
        project: restricted ? "" : q.projectName ?? q.inquiry.projectName ?? "",
        dateMs: d.getTime(),
        dateText: formatDate(d),
        currency: q.currency,
        value: restricted ? 0 : value,
        collected: restricted ? 0 : collected,
        balance: restricted ? 0 : balance,
        arrangement: ARRANGEMENT_LABEL[sale.arrangement],
        status,
        sales: q.preparedBy.name,
        stage: wf.stage,
        stageText: stageLabel(wf.stage),
        prodDepts,
        nextStep: next?.key ?? null,
        nextLabel: next?.label ?? null,
        canAct,
        blockedReason,
        awaiting: awaitingAll,
        awaitingNames,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o != null)
    .sort((a, b) => b.dateMs - a.dateMs);

  const currency = orders[0]?.currency ?? "PHP";
  const totalValue = round2(orders.reduce((a, o) => a + o.value, 0));
  const totalCollected = round2(orders.reduce((a, o) => a + o.collected, 0));
  const totalOutstanding = round2(orders.reduce((a, o) => a + o.balance, 0));

  const tiles = restricted
    ? [{ label: "Orders", value: String(orders.length) }]
    : [
        { label: "Orders", value: String(orders.length) },
        { label: "Order value", value: formatCurrency(totalValue, currency) },
        { label: "Collected", value: formatCurrency(totalCollected, currency) },
        { label: "Outstanding", value: formatCurrency(totalOutstanding, currency) },
      ];

  return (
    <div className="space-y-6">
      <AutoRefresh />
      <div>
        <h1 className="text-2xl font-bold">Orders</h1>
        <p className="text-sm text-muted-foreground">Confirmed sales — order value, collected, and outstanding balance.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardHeader className="pb-1">
              <CardTitle className="text-xs uppercase text-muted-foreground">{t.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold tabular-nums">{t.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-6">
          {orders.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No confirmed orders yet. A quote becomes an order once its sale is recorded (PO attached).
            </p>
          ) : (
            <OrdersTable
              orders={orders}
              progressHidden={progressHidden}
              restricted={restricted}
              initialStage={stageParam}
              initialStageLabel={stageParam ? stageLabel(stageParam) : undefined}
              initialDept={deptParam}
              initialDeptLabel={deptParam ? deptLabel(deptParam as (typeof PRODUCTION_DEPTS)[number]["key"]) : undefined}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
