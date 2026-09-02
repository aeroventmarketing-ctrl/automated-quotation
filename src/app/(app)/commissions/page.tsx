import Link from "next/link";
import { CheckCircle2, Clock, TrendingDown } from "lucide-react";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { round2 } from "@/lib/quote";
import {
  buildCommissions,
  allDeals,
  isPayable,
  MONTHLY_QUOTA_GROSS,
  COMMISSION_RATE_PCT,
  type CommissionMonth,
  type CommissionDeal,
} from "@/lib/sales-commission";
import { MarkPaid } from "./mark-paid";

export const dynamic = "force-dynamic";

const monthLabel = (salesMonth: string) => {
  const m = /^(\d{4})-(\d{2})$/.exec(salesMonth);
  if (!m) return salesMonth;
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(Number(m[1]), Number(m[2]) - 1, 1));
};

/** Why this deal sits in this month — rule 2, said out loud. */
const basisLabel: Record<CommissionDeal["basis"], string> = {
  po: "PO submitted",
  payment: "Down payment",
  counter: "Walk-in sale",
};

export default async function CommissionsPage() {
  const [viewer, assignments] = await Promise.all([getCurrentUser(), getWorkflowRoles()]);
  const canManage = isAdmin(viewer) || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "accounting"));
  // Accounting/admin manage (mark paid); the Payment Approver sees all. Sales may
  // view — but only their OWN commissions.
  const canSeeAll = canManage || (viewer != null && userHasWorkflowRole(assignments, viewer.id, "payment_approver"));
  const isSales = viewer?.role === "SALES";
  const canView = canSeeAll || isSales;

  if (!canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Commissions</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to sales commissions. Ask an admin for the Accounting role.</p>
      </div>
    );
  }

  let view: Awaited<ReturnType<typeof buildCommissions>> | null = null;
  let failed = false;
  try {
    view = await buildCommissions({ salespersonId: canSeeAll ? undefined : viewer!.id });
  } catch {
    failed = true;
  }

  const months = view?.months ?? [];
  const currency = view?.currency ?? "PHP";
  const deals = view ? allDeals(view) : [];
  const payableNow = deals.filter(isPayable);
  const awaitingPayment = deals.filter((d) => !d.fullyPaid);
  const belowQuota = months.filter((m) => !m.qualifies);

  const tiles = [
    { label: "Payable now", value: formatCurrency(round2(payableNow.reduce((a, d) => a + d.amount, 0)), currency), caption: `${payableNow.length} approved, unpaid` },
    { label: "Paid out", value: formatCurrency(view?.totals.paid ?? 0, currency), caption: `${deals.filter((d) => d.paid).length} released` },
    { label: "Awaiting full payment", value: String(awaitingPayment.length), caption: "client still owing" },
    { label: "Months below quota", value: String(belowQuota.length), caption: `under ${formatCurrency(MONTHLY_QUOTA_GROSS, currency)}` },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Commissions</h1>
        <p className="text-sm text-muted-foreground">
          {COMMISSION_RATE_PCT}% of sales less VAT, per salesperson per month. Approved automatically once the month
          and the client both qualify.
        </p>
      </div>

      {/* The rules, on the page they are enforced on — so a salesperson can see
          why a month paid nothing without asking Accounting. */}
      <Card className="border-primary/25 bg-primary/5">
        <CardHeader className="pb-2"><CardTitle className="text-sm">How a commission is earned</CardTitle></CardHeader>
        <CardContent className="grid gap-x-6 gap-y-1.5 text-xs text-muted-foreground sm:grid-cols-2">
          <p><span className="font-semibold text-foreground">1 · The month.</span> The salesperson&apos;s sales for the month must exceed {formatCurrency(MONTHLY_QUOTA_GROSS, currency)} gross. Below that, nothing in the month is earned.</p>
          <p><span className="font-semibold text-foreground">2 · The month it counts in.</span> A terms client counts in the month their PO was submitted; everyone else in the month of their down payment.</p>
          <p><span className="font-semibold text-foreground">3 · Full payment.</span> The client must have paid the order in full — whenever that happens.</p>
          <p><span className="font-semibold text-foreground">4 · Release.</span> On the next 15th or 30th after full payment (February releases on the last day).</p>
          <p><span className="font-semibold text-foreground">5 · Approval.</span> Automatic — meeting 1–3 approves it; no one signs off the entitlement.</p>
          <p><span className="font-semibold text-foreground">6 · The rate.</span> {COMMISSION_RATE_PCT}% of gross sales less VAT.</p>
        </CardContent>
      </Card>

      {failed ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          The commissions table isn&apos;t set up yet. Run migration 0007 in Supabase, then record a sale to generate commissions.
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {tiles.map((t) => (
              <Card key={t.label}>
                <CardHeader className="pb-1"><CardTitle className="text-xs uppercase text-muted-foreground">{t.label}</CardTitle></CardHeader>
                <CardContent>
                  <div className="text-xl font-bold tabular-nums">{t.value}</div>
                  <p className="text-[11px] text-muted-foreground">{t.caption}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {months.length === 0 ? (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
              No confirmed sales yet. A deal appears here in the month its PO (terms) or down payment (everyone else) landed.
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              {months.map((m) => (
                <MonthCard key={`${m.salespersonId}-${m.salesMonth}`} month={m} currency={currency} canManage={canManage} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MonthCard({ month: m, currency, canManage }: { month: CommissionMonth; currency: string; canManage: boolean }) {
  return (
    <Card className={m.qualifies ? "border-emerald-600/30" : ""}>
      <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">{m.salespersonName}</CardTitle>
          <p className="text-xs text-muted-foreground">{monthLabel(m.salesMonth)} · {m.deals.length} sale{m.deals.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-right">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sales this month</p>
            <p className="text-sm font-semibold tabular-nums">{formatCurrency(m.monthGross, currency)}</p>
          </div>
          {m.qualifies ? (
            <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Qualified</Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-700">
              <TrendingDown className="h-3 w-3" /> {formatCurrency(m.shortfall, currency)} short of {formatCurrency(MONTHLY_QUOTA_GROSS, currency)}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dated</TableHead>
                <TableHead>Order</TableHead>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net of VAT</TableHead>
                <TableHead className="text-right">{COMMISSION_RATE_PCT}%</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {m.deals.map((d) => (
                <TableRow key={`${d.kind}-${d.refId}`} id={`commission-${d.kind}-${d.refId}`} className="scroll-mt-24 target:bg-primary/10">
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDate(d.recognisedYMD)}
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{basisLabel[d.basis]}</span>
                  </TableCell>
                  <TableCell><Link href={d.href} className="text-primary hover:underline">{d.refLabel}</Link></TableCell>
                  <TableCell className="text-sm">{d.company}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(d.gross, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(d.net, currency)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {d.approved ? formatCurrency(d.amount, currency) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell><DealStatus deal={d} qualifies={m.qualifies} currency={currency} /></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {d.approved ? <MarkPaid kind={d.kind} refId={d.refId} paid={d.paid} /> : null}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t pt-3 text-sm">
          <span className="text-muted-foreground">Earned <span className="font-semibold tabular-nums text-foreground">{formatCurrency(m.earned, currency)}</span></span>
          <span className="text-muted-foreground">Paid <span className="font-semibold tabular-nums text-foreground">{formatCurrency(m.paid, currency)}</span></span>
          <span className="text-muted-foreground">Unpaid <span className="font-semibold tabular-nums text-foreground">{formatCurrency(m.unpaid, currency)}</span></span>
          {m.nextPayoutYMD && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
              <Clock className="h-3.5 w-3.5" /> Next release {formatDate(m.nextPayoutYMD)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function DealStatus({ deal: d, qualifies, currency }: { deal: CommissionDeal; qualifies: boolean; currency: string }) {
  if (d.paid) return <Badge variant="success">Paid{d.paidByName ? ` · ${d.paidByName}` : ""}</Badge>;
  if (d.approved) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <Badge variant="default" className="w-fit">Approved · automatic</Badge>
        <span className="text-[10px] text-muted-foreground">Release {formatDate(d.payoutYMD)}</span>
      </span>
    );
  }
  if (!d.fullyPaid) {
    // A walk-in can be collected in full and still not count: a cheque that
    // hasn't landed is not payment. Saying "₱0.00 outstanding" there would read
    // as a bug, so the two cases get different words.
    const outstanding = round2(Math.max(0, d.gross - d.collected));
    return (
      <span className="inline-flex flex-col gap-0.5">
        <Badge variant="outline" className="w-fit border-muted-foreground/40 text-muted-foreground">
          {outstanding > 0 ? "Awaiting full payment" : "Payment not cleared"}
        </Badge>
        <span className="text-[10px] text-muted-foreground">
          {outstanding > 0 ? `${formatCurrency(outstanding, currency)} outstanding` : "collected, waiting to clear"}
        </span>
      </span>
    );
  }
  // Fully paid, but the month didn't clear the quota — rule 1.
  return (
    <span className="inline-flex flex-col gap-0.5">
      <Badge variant="outline" className="w-fit border-amber-500/60 text-amber-700">Month below quota</Badge>
      {d.payoutYMD && <span className="text-[10px] text-muted-foreground">Would release {formatDate(d.payoutYMD)}</span>}
    </span>
  );
}
