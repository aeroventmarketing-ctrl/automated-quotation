import Link from "next/link";
import { AlertTriangle, FileText } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { isAdmin } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { getCounterSaleViewer } from "@/lib/counter-sale-access";
import {
  COUNTER_STATUS_LABEL,
  COUNTER_VAT_LABEL,
  counterDocSlots,
  coerceCounterDocs,
  coerceCounterPayments,
  paymentMethodLabel,
  isCashMethod,
  adhocLines,
  COUNTER_FINAL_PAYMENT_SLOT,
  type CounterSaleStatusKey,
  type CounterSaleVatMode,
} from "@/lib/counter-sale";
import { CounterSaleDocs } from "../counter-sale-docs";
import { CounterSalePayments } from "../counter-sale-payments";
import { CounterSaleActions } from "../counter-sale-actions";
import { CounterSaleAdminEdit } from "../counter-sale-admin-edit";

export const dynamic = "force-dynamic";

const STATUS_VARIANT: Record<CounterSaleStatusKey, "secondary" | "success" | "destructive"> = {
  DRAFT: "secondary",
  COMPLETED: "success",
  VOID: "destructive",
};

function fmtWhen(d: Date | null): string {
  return d ? d.toLocaleString("en-PH", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}
function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "";
}

export default async function CounterSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, allowed } = await getCounterSaleViewer();
  if (!allowed) redirect("/counter-sales");
  const admin = isAdmin(user);

  const sale = await prisma.counterSale.findUnique({
    where: { id },
    include: { customer: true, items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!sale) notFound();

  const status = sale.status as CounterSaleStatusKey;
  // The lines that bypass the warehouse — see `adhocLines`.
  const adhoc = adhocLines(sale.items.map((i) => ({ stockItemId: i.stockItemId, description: i.description, qty: Number(i.qty) })));
  const vatMode = sale.vatMode as CounterSaleVatMode;
  const slots = counterDocSlots(vatMode);
  const docs = coerceCounterDocs(sale.docs);
  const payments = coerceCounterPayments(sale.payments);
  const nonCash = !isCashMethod(sale.paymentMethod);
  const uncleared = status === "COMPLETED" && !sale.paymentCleared;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/counter-sales" className="text-sm text-muted-foreground hover:underline">Counter Sales</Link>
            <span className="text-muted-foreground">/</span>
            <h1 className="font-mono text-base font-semibold">{sale.saleNumber ?? "Draft sale"}</h1>
            <Badge variant={STATUS_VARIANT[status]} className="font-normal">{COUNTER_STATUS_LABEL[status]}</Badge>
            <Badge variant={vatMode === "INCLUSIVE" ? "secondary" : "default"} className="font-normal">{COUNTER_VAT_LABEL[vatMode].long}</Badge>
            {uncleared && <Badge variant="warning" className="font-normal">Payment Uncleared</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {sale.customer.company}
            {sale.customer.contactName ? ` · ${sale.customer.contactName}` : ""}
            {sale.customer.phone ? ` · ${sale.customer.phone}` : ""}
          </p>
          {(admin || user?.role === "SALES" || user?.role === "ENGINEER") && (
            <Link href={`/inquiries/new?customerId=${sale.customerId}`} className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
              <FileText className="h-3.5 w-3.5" /> Quote This Client (New Inquiry)
            </Link>
          )}
        </div>
        <CounterSaleActions
          saleId={sale.id}
          status={status}
          adhocDescriptions={adhoc.map((i) => i.description)}
          admin={admin}
          nonCash={nonCash}
          paymentCleared={sale.paymentCleared}
          paymentDue={fmtDate(sale.paymentDueAt)}
        />
      </div>

      {admin && (
        <CounterSaleAdminEdit
          saleId={sale.id}
          initial={{
            vatMode,
            paymentMethod: sale.paymentMethod,
            salespersonId: sale.salespersonId,
            notes: sale.notes ?? "",
            lines: sale.items.map((it) => ({ stockItemId: it.stockItemId, description: it.description, unit: it.unit, qty: String(Number(it.qty)), unitPrice: String(Number(it.unitPrice)) })),
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Items + totals */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Items</CardTitle></CardHeader>
          <CardContent>
            {/* Which half of this sale touches the warehouse. A line only
                deducts when its item was PICKED from the stock list, and the
                picker defaults to "Ad-hoc / Not In Inventory" — so a typed line
                sells the goods and leaves the on-hand untouched, silently. That
                silence is what the owner reported as inventory "not deducting". */}
            {adhoc.length > 0 && (
              <p className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <strong>{adhoc.length}</strong> of these {adhoc.length === 1 ? "lines is" : "lines are"} not linked to an
                  inventory item, so {status === "COMPLETED" ? "completing this sale did not deduct them" : "completing this sale will not deduct them"} from
                  stock: {adhoc.map((i) => i.description).join(", ")}.
                  {status === "DRAFT" && " Pick the item from the Item list on each line if it should come out of the warehouse."}
                </span>
              </p>
            )}
            <ul className="divide-y text-sm">
              {sale.items.map((it) => (
                <li key={it.id} className="flex flex-wrap items-center gap-x-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{it.description}{it.stockItemId ? "" : <span className="ml-1 text-[11px] text-amber-700">· not in inventory</span>}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{Number(it.qty)} {it.unit} × {formatCurrency(Number(it.unitPrice))}</span>
                  <span className="w-28 shrink-0 text-right font-medium tabular-nums">{formatCurrency(Number(it.lineTotal))}</span>
                </li>
              ))}
            </ul>
            <div className="ml-auto mt-3 max-w-xs space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Net{vatMode === "INCLUSIVE" ? " Of VAT" : ""}</span><span className="tabular-nums">{formatCurrency(Number(sale.subtotal))}</span></div>
              {vatMode === "INCLUSIVE" && <div className="flex justify-between"><span className="text-muted-foreground">VAT (12%)</span><span className="tabular-nums">{formatCurrency(Number(sale.vat))}</span></div>}
              <div className="flex justify-between border-t pt-1 text-base font-semibold"><span>Total</span><span className="tabular-nums">{formatCurrency(Number(sale.total))}</span></div>
            </div>
          </CardContent>
        </Card>

        {/* Payment + meta */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Payment</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Method</span><span>{paymentMethodLabel(sale.paymentMethod)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Amount Paid</span><span className="tabular-nums">{formatCurrency(Number(sale.amountPaid))}</span></div>
            {status === "COMPLETED" && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Status</span>
                {sale.paymentCleared
                  ? <span className="text-emerald-700">Cleared{sale.clearedByName ? ` · ${sale.clearedByName}` : ""}</span>
                  : <span className="text-amber-700">Uncleared</span>}
              </div>
            )}
            {sale.paymentDueAt && <div className="flex justify-between"><span className="text-muted-foreground">Expected Clearing</span><span>{fmtDate(sale.paymentDueAt)}</span></div>}
            <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">
              <div>Recorded by {sale.soldByName}</div>
              {sale.salespersonName && <div>Salesperson: {sale.salespersonName}</div>}
              <div>{status === "COMPLETED" ? `Completed ${fmtWhen(sale.completedAt)}` : `Started ${fmtWhen(sale.createdAt)}`}</div>
              {sale.voidedByName && <div className="text-destructive">Voided by {sale.voidedByName} · {fmtWhen(sale.voidedAt)}</div>}
            </div>
            {sale.notes && <div className="mt-2 rounded-md bg-muted/40 p-2 text-xs">{sale.notes}</div>}
          </CardContent>
        </Card>
      </div>

      {/* Documents */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Payments collected, with the proof of each — the same list an order
              carries, so a walk-in payment is evidenced the same way. */}
          <CounterSalePayments
            saleId={sale.id}
            currency={sale.currency}
            saleTotal={Number(sale.total)}
            amountPaid={Number(sale.amountPaid)}
            initialPayments={payments}
            canEdit={status !== "VOID"}
          />
          <CounterSaleDocs saleId={sale.id} slots={[COUNTER_FINAL_PAYMENT_SLOT]} docs={docs} canEdit={status !== "VOID"} admin={admin} />

          <div>
          <p className="mb-2 text-xs text-muted-foreground">
            {vatMode === "INCLUSIVE"
              ? "VAT-inclusive: Sales Invoice, Collection Receipt and Delivery Receipt (BIR 2307 optional)."
              : vatMode === "ZERO_RATED"
              ? "VAT zero-rated: Sales Invoice, Collection Receipt, Delivery Receipt, EWT (BIR 2307) and Certificate of VAT Exempt/Zero Rated."
              : "VAT-exclusive: Delivery Form and Acknowledgement Form (BIR 2307 optional)."}
          </p>
          <CounterSaleDocs saleId={sale.id} slots={slots} docs={docs} canEdit={status !== "VOID"} admin={admin} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
