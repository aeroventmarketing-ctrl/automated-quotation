import { prisma } from "@/lib/db";
import { AutoRefresh } from "@/components/auto-refresh";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";
import { payableTotal, round2 } from "@/lib/quote";
import { isBoughtInOnlyOrder, isStockOnlyOrder, isDuctHardwareStockOnly } from "@/lib/department-pnl";
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
import { formatJoNumber } from "@/lib/job-order";
import { formatDuctJoNumber } from "@/lib/duct-job-order";
import { formatAccessoriesJoNumber } from "@/lib/accessories-job-order";
import { formatMotorControllerJoNumber } from "@/lib/motor-controller-job-order";
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
    // Source from confirmed sales — NOT inquiry.status === "WON". A quotation
    // revision reopens the inquiry (status leaves WON), so a WON filter would
    // drop confirmed orders from the list. isSaleConfirmed below is the real
    // gate, exactly as the departmental P&L does it. (Owner-approved edit.)
    /**
     * SELECT, not include.
     *
     * This page has no WHERE clause — whether a quotation is a confirmed sale
     * lives inside its `classification` JSON, so every quotation is read and
     * filtered in memory. That is survivable; reading every COLUMN of every one
     * is not. At 1,142 quotations the row data alone was 3.2 MB, pulled every
     * eight seconds per open tab — about 2.1 TB of Supabase egress a month, and
     * enough query load on Micro compute to take the whole app down with it.
     *
     * So: only the fields the list actually renders. `terms` and `notes` (long
     * per-quotation text), `headerUnits`, the template and approver keys, and
     * the whole User and Customer rows behind `preparedBy` and `customer` — all
     * dropped. Nothing the page shows comes from any of them.
     *
     * `classification` stays, and is the bulk of what remains: it carries both
     * the sale record and the order workflow this list is built from.
     */
    prisma.quotation.findMany({
      select: {
        id: true, quoteNumber: true, currency: true, projectName: true, createdAt: true,
        // What `payableTotal` needs, and no more.
        total: true, discountPct: true, vatMode: true,
        classification: true,
        inquiry: { select: { projectName: true, customer: { select: { id: true, company: true } } } },
        preparedBy: { select: { name: true } },
        items: { select: { qty: true, descriptionSnapshot: true, specsSnapshot: true } },
      },
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
  // Purchaser view: swap the money columns (Value/Collected/Balance) for the
  // Engineer-generated Job Order numbers. Admins keep the full financial view.
  const isPurchaserView = !adminViewer && viewer != null && userHasWorkflowRole(assignments, viewer.id, "purchaser");

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
      // A fully bought-in order skips production: it uses the PO flow, so its
      // Phase 1 clear-payment button and its "released" stage read differently.
      const boughtInOnly = isBoughtInOnlyOrder(q.items);
      const stockOnly = isStockOnlyOrder(q.items);
      const canAct = next != null && (adminViewer || (viewer != null && userHasWorkflowRole(assignments, viewer.id, next.requiredRole)));
      // "Mark documents checked" is blocked until the required docs are attached.
      const docMissing = docCheckGate && next?.key === "doc_check" ? docCheckMissing(sale) : [];
      const blockedReason = docMissing.length ? `Attach: ${docMissing.join(", ")}` : null;
      // Who acts next across the whole order (all phases), for the "Awaiting" hint.
      const pend = pendingStep(wf, stockOnly, stockOnly && isDuctHardwareStockOnly(q.items), wf.officePickup === true, wf.fulfillmentMode === "plant_pickup");
      const awaitingAll = pend
        ? pend.sales
          ? "Sales"
          : [...(pend.engineer ? ["Engineer"] : []), ...pend.roles.map(workflowRoleLabel)].join(", ") || null
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

      // Job Order numbers generated by the Engineer, per department — shown to
      // the Purchaser in place of the money columns. Each links to the JO workflow.
      const joYear = new Date().getFullYear();
      const jobOrders: { number: string; dept: string }[] = [];
      wf.fansJobOrders.forEach((_, i) => { if (wf.joBaseNo != null) jobOrders.push({ dept: "Fans", number: formatJoNumber(wf.joBaseNo, wf.joBaseYear ?? joYear, i, wf.fansJobOrders.length) }); });
      wf.ductJobOrders.forEach((_, i) => { if (wf.ductJoBaseNo != null) jobOrders.push({ dept: "Duct", number: formatDuctJoNumber(wf.ductJoBaseNo, wf.ductJoBaseYear ?? joYear, i, wf.ductJobOrders.length) }); });
      wf.accessoriesJobOrders.forEach((_, i) => { if (wf.accJoBaseNo != null) jobOrders.push({ dept: "Accessories", number: formatAccessoriesJoNumber(wf.accJoBaseNo, wf.accJoBaseYear ?? joYear, i, wf.accessoriesJobOrders.length) }); });
      wf.motorJobOrders.forEach((_, i) => { if (wf.mcJoBaseNo != null) jobOrders.push({ dept: "Motor", number: formatMotorControllerJoNumber(wf.mcJoBaseNo, wf.mcJoBaseYear ?? joYear, i, wf.motorJobOrders.length) }); });

      const d = orderDate(sale, q.createdAt);
      return {
        id: q.id,
        quoteNumber: q.quoteNumber,
        jobOrders,
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
        stageText: boughtInOnly && wf.stage === "released" ? "For PO creation"
          : stockOnly && wf.stage === "released" ? "For stock release"
          : boughtInOnly && wf.stage === "qa_plant_checked" ? "For transfer to office"
          : stageLabel(wf.stage),
        prodDepts,
        nextStep: next?.key ?? null,
        nextLabel: boughtInOnly && next?.key === "payment_cleared" ? "Clear payment & create PO"
          : stockOnly && next?.key === "payment_cleared" ? "Clear payment & release from stock"
          : (next?.label ?? null),
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
      <AutoRefresh seconds={8} watch="orders" />
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
              isPurchaser={isPurchaserView}
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
