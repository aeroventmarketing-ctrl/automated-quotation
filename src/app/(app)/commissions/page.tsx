import Link from "next/link";
import { CheckCircle2, Clock, TrendingDown } from "lucide-react";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, usersWithWorkflowRole, WORKFLOW_ROLE_KEYS, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { getSalesPersonnelIds } from "@/lib/sales-personnel";
import { commissionAccess } from "@/lib/commission-access";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { round2 } from "@/lib/quote";
import {
  buildCommissions,
  allDeals,
  isPayable,
  dealKey,
  MONTHLY_QUOTA_GROSS,
  COMMISSION_RATE_PCT,
  OVERRIDE_RATE_PCT,
  SALES_START_YMD,
  type CommissionMonth,
  type CommissionDeal,
} from "@/lib/sales-commission";
import { MarkPaid } from "./mark-paid";
import { PayoutPanel, type PayoutRow } from "./payout-panel";
import { getCommissionVoucherNoByDeal } from "@/lib/commission-voucher";

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
  const [viewer, assignments, salesPersonnelIds] = await Promise.all([
    getCurrentUser(), getWorkflowRoles(), getSalesPersonnelIds().catch(() => [] as string[]),
  ]);
  // One rule, in `lib/commission-access`: Accounting/admin manage, the Payment
  // Approver sees all, and anyone who can EARN a commission — a SALES user, an
  // Engineer credited as a salesperson, or the Sales Head — sees their own.
  const { canView, canSeeAll, canManage } = commissionAccess({
    admin: isAdmin(viewer),
    baseRole: viewer?.role ?? "",
    workflowRoles: WORKFLOW_ROLE_KEYS.filter((k) => viewer != null && userHasWorkflowRole(assignments, viewer.id, k as WorkflowRoleKey)),
    salesPersonnel: viewer != null && salesPersonnelIds.includes(viewer.id),
  });

  if (!viewer || !canView) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Commissions</h1>
        <p className="text-sm text-muted-foreground">You don&apos;t have access to sales commissions. Ask an admin for the Accounting role.</p>
      </div>
    );
  }

  // A Sales Head with nobody on the allow-list earns nothing, which would look
  // like a bug rather than a setting. Say so, to the people who can fix it.
  const headCount = usersWithWorkflowRole(assignments, "sales_head").length;
  const sourceCount = usersWithWorkflowRole(assignments, "override_source").length;
  const overrideUnset = headCount > 0 && sourceCount === 0 && canSeeAll;

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

  // Money leaves the company one voucher per salesperson, not one per order, so
  // the payable rows are rolled up per person here — across every month and both
  // rates. A voucher number appears once one has been printed for exactly this
  // set of commissions.
  const voucherByDeal = await getCommissionVoucherNoByDeal().catch(() => new Map<string, string>());
  const payoutRows: PayoutRow[] = [...payableNow
    .reduce((m, d) => {
      const r = m.get(d.salespersonId) ?? {
        salespersonId: d.salespersonId, salespersonName: d.salespersonName,
        count: 0, total: 0, nextReleaseYMD: null as string | null, voucherNo: null as string | null,
      };
      r.count += 1;
      r.total = round2(r.total + d.amount);
      if (d.payoutYMD && (!r.nextReleaseYMD || d.payoutYMD < r.nextReleaseYMD)) r.nextReleaseYMD = d.payoutYMD;
      // Only show a number when the printed voucher covers this row — a voucher
      // printed before another client paid no longer describes what is owed.
      r.voucherNo = r.voucherNo ?? voucherByDeal.get(dealKey(d)) ?? null;
      return m.set(d.salespersonId, r);
    }, new Map<string, PayoutRow>())
    .values()]
    .sort((a, b) => b.total - a.total);

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
          <p><span className="font-semibold text-foreground">4 · Release.</span> A month&apos;s commissions start on the <strong>15th of the following month</strong> — the target isn&apos;t settled until the month ends — then on each 15th and 30th as the remaining clients pay in full. A month with 31 days releases on the 30th; February on the 28th (29th in a leap year).</p>
          <p><span className="font-semibold text-foreground">5 · Approval.</span> Automatic — meeting 1–3 approves it; no one signs off the entitlement.</p>
          <p className="sm:col-span-2"><span className="font-semibold text-foreground">The Sales Head&apos;s override.</span> Whoever holds the <em>Sales Head</em> role also earns {OVERRIDE_RATE_PCT}% of each <em>listed</em> salesperson&apos;s qualifying month, on the same net-of-VAT base and released on the same dates. It is on top of the {COMMISSION_RATE_PCT}% — the salesperson&apos;s own commission is untouched — never applies to the Sales Head&apos;s own sales, and is <strong>not conditional on the Sales Head hitting their own target</strong>. Only salespeople ticked <em>Counts toward override</em> in Admin → Workflow roles are included.</p>
          <p><span className="font-semibold text-foreground">6 · The rate.</span> {COMMISSION_RATE_PCT}% of gross sales less VAT. VAT is deducted only where the client was charged it — a <em>VAT exclusive</em> or <em>zero rated</em> order pays {COMMISSION_RATE_PCT}% of its full amount.</p>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Commissions are counted from <strong>{formatDate(SALES_START_YMD)}</strong> onwards. Earlier sales are
        hidden here, not deleted — they remain on Orders, the WON report and the P&amp;L.
      </p>

      {overrideUnset && (
        <Card className="border-amber-500/40 bg-amber-50/60 dark:bg-amber-950/20">
          <CardContent className="py-3 text-xs text-amber-800 dark:text-amber-300">
            A <strong>Sales Head</strong> is assigned, but no salesperson is ticked{" "}
            <strong>Counts toward override</strong> — so no {OVERRIDE_RATE_PCT}% override is being earned. Tick the
            salespeople it applies to in <Link href="/admin/workflow-roles" className="underline">Admin → Workflow roles</Link>.
          </CardContent>
        </Card>
      )}

      {/* Only the people who can act on it: the voucher page itself is Accounting
          / Payment Approver / admin, so showing a salesperson a "Cash voucher"
          button that 404s for them would be a dead end. They see their own totals
          on the month cards and the dashboard tile. */}
      {canSeeAll && payoutRows.length > 0 && <PayoutPanel rows={payoutRows} canManage={canManage} currency={currency} />}

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
              No confirmed sales since {formatDate(SALES_START_YMD)}. A deal appears here in the month its PO (terms) or down payment (everyone else) landed.
            </CardContent></Card>
          ) : (
            <div className="space-y-4">
              {months.map((m) => (
                <MonthCard key={`${m.salespersonId}-${m.salesMonth}-${m.kind}`} month={m} currency={currency} canManage={canManage} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MonthCard({ month: m, currency, canManage }: { month: CommissionMonth; currency: string; canManage: boolean }) {
  const isOverride = m.kind === "override";
  return (
    <Card className={isOverride ? "border-violet-600/30" : m.qualifies ? "border-emerald-600/30" : ""}>
      <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">
            {m.salespersonName}
            {isOverride && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-950 dark:text-violet-300">Sales Head override</span>}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {monthLabel(m.salesMonth)} · {m.deals.length} sale{m.deals.length === 1 ? "" : "s"}
            {isOverride ? ` · ${OVERRIDE_RATE_PCT}% of listed salespeople's qualifying months` : ""}
          </p>
        </div>
        {/* An override card has no quota of its own — every row on it exists
            because SOMEONE ELSE's month already cleared ₱1,000,000. Showing
            "₱1,000,000 short" there would be nonsense. */}
        <div className={`flex flex-wrap items-center gap-2 text-right ${isOverride ? "hidden" : ""}`}>
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
                <TableHead className="text-right">Commission base</TableHead>
                <TableHead className="text-right">{isOverride ? `${OVERRIDE_RATE_PCT}%` : `${COMMISSION_RATE_PCT}%`}</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {m.deals.map((d) => (
                <TableRow key={`${d.kind}-${d.refId}-${d.payeeKind}`} id={`commission-${d.kind}-${d.refId}-${d.payeeKind}`} className="scroll-mt-24 target:bg-primary/10">
                  <TableCell className="whitespace-nowrap text-sm">
                    {formatDate(d.recognisedYMD)}
                    <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">{basisLabel[d.basis]}</span>
                  </TableCell>
                  <TableCell><Link href={d.href} className="text-primary hover:underline">{d.refLabel}</Link></TableCell>
                  <TableCell className="text-sm">
                    {d.company}
                    {d.sourceSalespersonName && (
                      <span className="block text-[10px] text-muted-foreground">sold by {d.sourceSalespersonName}</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(d.gross, currency)}</TableCell>
                  {/* A VAT-exclusive / zero-rated deal has no VAT to strip, so its
                      base equals its gross. Saying so stops the repeated figure
                      reading as a bug. */}
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(d.net, currency)}
                    <span className="block text-[10px] uppercase tracking-wide">
                      {d.vatDeducted ? "less VAT" : "no VAT charged"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {d.approved ? formatCurrency(d.amount, currency) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell><DealStatus deal={d} qualifies={m.qualifies} currency={currency} /></TableCell>
                  {canManage && (
                    <TableCell className="text-right">
                      {d.approved ? <MarkPaid kind={d.kind} refId={d.refId} payeeKind={d.payeeKind} paid={d.paid} /> : null}
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
