import Link from "next/link";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { payableTotal, round2 } from "@/lib/quote";
import {
  saleFromClassification,
  isSaleConfirmed,
  collectedTotal,
  ARRANGEMENT_LABEL,
  type SaleRecord,
} from "@/lib/sale";
import { getWorkflowRoles, userHasWorkflowRole, workflowRoleLabel } from "@/lib/workflow-roles";
import { readOrderWorkflow, nextOrderStep, stageLabel, pendingStep } from "@/lib/order-workflow";
import { OrderStageActions } from "./order-stage-actions";

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
export default async function OrdersPage() {
  const [quotes, viewer, assignments] = await Promise.all([
    prisma.quotation.findMany({
      where: { inquiry: { status: "WON" } },
      include: { inquiry: { include: { customer: true } }, preparedBy: true },
      orderBy: { createdAt: "desc" },
    }),
    getCurrentUser(),
    getWorkflowRoles(),
  ]);
  const adminViewer = isAdmin(viewer);

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
      // Who acts next across the whole order (all phases), for the "Awaiting" hint.
      const pend = pendingStep(wf);
      const awaitingAll = pend
        ? pend.sales
          ? "Sales"
          : pend.roles.length
            ? pend.roles.map(workflowRoleLabel).join(", ")
            : null
        : null;

      return {
        id: q.id,
        quoteNumber: q.quoteNumber,
        company: q.inquiry.customer.company,
        project: q.projectName ?? q.inquiry.projectName ?? "",
        date: orderDate(sale, q.createdAt),
        currency: q.currency,
        value,
        collected,
        balance,
        arrangement: ARRANGEMENT_LABEL[sale.arrangement],
        status,
        sales: q.preparedBy.name,
        stage: wf.stage,
        stageText: stageLabel(wf.stage),
        nextStep: next?.key ?? null,
        nextLabel: next?.label ?? null,
        canAct,
        awaiting: awaitingAll,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o != null)
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  const currency = orders[0]?.currency ?? "PHP";
  const totalValue = round2(orders.reduce((a, o) => a + o.value, 0));
  const totalCollected = round2(orders.reduce((a, o) => a + o.collected, 0));
  const totalOutstanding = round2(orders.reduce((a, o) => a + o.balance, 0));

  const tiles = [
    { label: "Orders", value: String(orders.length) },
    { label: "Order value", value: formatCurrency(totalValue, currency) },
    { label: "Collected", value: formatCurrency(totalCollected, currency) },
    { label: "Outstanding", value: formatCurrency(totalOutstanding, currency) },
  ];

  const statusVariant = (s: string) => (s === "Paid" ? "success" : s === "Partial" ? "warning" : "secondary");

  return (
    <div className="space-y-6">
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Terms</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Collected</TableHead>
                    <TableHead className="text-right">Balance</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Order stage</TableHead>
                    <TableHead>Sales</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link href={`/quotations/${o.id}`} className="font-medium text-primary hover:underline">
                          {o.quoteNumber}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{o.company}</div>
                        {o.project && <div className="text-xs text-muted-foreground">{o.project}</div>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatDate(o.date)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{o.arrangement}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(o.value, o.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(o.collected, o.currency)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(o.balance, o.currency)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(o.status)}>{o.status}</Badge>
                      </TableCell>
                      <TableCell>
                        <OrderStageActions
                          orderId={o.id}
                          stage={o.stage}
                          stageLabel={o.stageText}
                          nextStep={o.nextStep}
                          nextLabel={o.nextLabel}
                          canAct={o.canAct}
                          awaiting={o.awaiting}
                        />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{o.sales}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
