"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock, Search, TrendingDown, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/lib/utils";
import { matchesQuery } from "@/lib/commission-search";
import type { CommissionDeal, CommissionMonth } from "@/lib/sales-commission";
import { MarkPaid } from "./mark-paid";
import { ReceivedStamp } from "./receipt-link";
import { RowProof } from "./proof-of-payment";
import { DealTick, CardTick } from "./voucher-selection";
import type { CommissionProofDoc } from "@/lib/commission-proof";

/**
 * The month cards, and the box that searches them.
 *
 * ## Why this is a client component
 *
 * The owner asked for a search bar; every other table in this app searches as
 * you type, so this one does too. That needs the rows in the browser — and the
 * rows cannot import `lib/sales-commission`, which reaches Prisma. So the page
 * resolves the four things that module decides (`dealKey`, `isVoucherable`,
 * `canMarkPaid`, `markPaidOpensYMD`) on the server and sends the answers down;
 * the types come across as `import type`, which compiles away to nothing.
 *
 * The consequence worth stating: **the browser cannot widen anything.** It
 * receives rows already decided and chooses which to show. A tick still carries
 * only a key, and the voucher page still recomputes every peso from the
 * confirmed sales.
 */

/** A deal, plus the answers only the server could give. */
export type SearchableDeal = CommissionDeal & {
  /** `dealKey(d)` — what a tick box sends. */
  key: string;
  /** `isVoucherable(d)` — approved and unpaid, so a voucher may include it. */
  voucherable: boolean;
  /** `canMarkPaid(d, today)` — the five-day window before release is open. */
  payNow: boolean;
  /** `markPaidOpensYMD(d.payoutYMD)` — when that window opens, if it can. */
  payOpensYMD: string | null;
  /** Lower-cased order number + client, built once on the server. */
  haystack: string;
};

export type SearchableMonth = Omit<CommissionMonth, "deals"> & { deals: SearchableDeal[] };

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

const round2 = (n: number) => Math.round(n * 100) / 100;

interface Rates {
  currency: string;
  quotaGross: number;
  ratePct: number;
  overrideRatePct: number;
}

export function CommissionMonths({
  months,
  canManage,
  canAttachProof,
  viewerId,
  ...rates
}: Rates & {
  months: SearchableMonth[];
  canManage: boolean;
  /** Accounting / Payment Approver / admin — may open any payout's slip. */
  canAttachProof: boolean;
  /** The viewer, so the payee can open their own. */
  viewerId: string;
}) {
  const [query, setQuery] = useState("");
  const searching = query.trim().length > 0;

  /**
   * Cards keep their identity while filtering — a month with no matching row
   * disappears rather than showing an empty table, but a month that matches
   * keeps its real `deals` alongside the visible subset, because its totals and
   * its quota badge are facts about the whole month and must stay true.
   */
  const shown = useMemo(() => {
    if (!searching) return months.map((m) => ({ month: m, visible: m.deals }));
    return months
      .map((m) => ({ month: m, visible: m.deals.filter((d) => matchesQuery(d.haystack, query)) }))
      .filter((x) => x.visible.length > 0);
  }, [months, query, searching]);

  const hits = shown.reduce((a, x) => a + x.visible.length, 0);
  const total = months.reduce((a, m) => a + m.deals.length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order number or client name…"
            className="h-9 w-full rounded-md border bg-background pl-8 pr-3 text-sm"
            aria-label="Search commissions by order number or client name"
          />
        </div>
        {searching && (
          <>
            <span className="text-xs text-muted-foreground">
              {hits} of {total} commission{total === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="inline-flex h-9 items-center gap-1 rounded-md border px-2.5 text-xs font-medium hover:bg-accent"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          </>
        )}
      </div>

      {shown.length === 0 ? (
        <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
          No commission matches <strong>{query.trim()}</strong>. Search by order number (
          <span className="font-mono">AFBM00003264</span>) or client name.
        </CardContent></Card>
      ) : (
        shown.map(({ month, visible }) => (
          <MonthCard
            key={`${month.salespersonId}-${month.salesMonth}-${month.kind}`}
            month={month}
            visible={visible}
            searching={searching}
            canManage={canManage}
            canAttachProof={canAttachProof}
            viewerId={viewerId}
            {...rates}
          />
        ))
      )}
    </div>
  );
}

function MonthCard({
  month: m,
  visible,
  searching,
  currency,
  quotaGross,
  ratePct,
  overrideRatePct,
  canManage,
  canAttachProof,
  viewerId,
}: Rates & {
  month: SearchableMonth;
  /** The rows on screen — every row, or the ones a search matched. */
  visible: SearchableDeal[];
  searching: boolean;
  canManage: boolean;
  canAttachProof: boolean;
  viewerId: string;
}) {
  const isOverride = m.kind === "override";
  /**
   * Select-all ticks WHAT IS ON SCREEN, never what a search is hiding. The
   * alternative — ticking the whole month from a filtered card — puts money on a
   * voucher the person never looked at.
   */
  const cardKeys = visible.filter((d) => d.voucherable).map((d) => d.key);
  // The Action column used to exist only for Accounting. The eye lives there now,
  // and the salesperson the card belongs to may open their own — so the column
  // appears for them as well, carrying just the eye.
  const ownCard = m.salespersonId === viewerId;
  const showAction = canManage || canAttachProof || ownCard;
  return (
    <Card className={isOverride ? "border-violet-600/30" : m.qualifies ? "border-emerald-600/30" : ""}>
      <CardHeader className="flex-row flex-wrap items-baseline justify-between gap-2 space-y-0 pb-3">
        <div>
          <CardTitle className="text-base">
            {m.salespersonName}
            {isOverride && <span className="ml-2 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-950 dark:text-violet-300">Sales Head override</span>}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            {monthLabel(m.salesMonth)} ·{" "}
            {/* While searching, say BOTH numbers. "3 sales" on a month that has
                seventeen is the kind of half-truth someone quotes in a meeting. */}
            {searching
              ? `${visible.length} of ${m.deals.length} sale${m.deals.length === 1 ? "" : "s"} match`
              : `${m.deals.length} sale${m.deals.length === 1 ? "" : "s"}`}
            {isOverride ? ` · ${overrideRatePct}% of listed salespeople's qualifying months` : ""}
          </p>
        </div>
        {/* An override card has no quota of its own — every row on it exists
            because SOMEONE ELSE's month already cleared ₱1,000,000. Showing
            "₱1,000,000 short" there would be nonsense.

            These two are month facts and stay whole while searching: hiding rows
            does not change what the month sold or whether it qualified. */}
        <div className={`flex flex-wrap items-center gap-2 text-right ${isOverride ? "hidden" : ""}`}>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Sales this month</p>
            <p className="text-sm font-semibold tabular-nums">{formatCurrency(m.monthGross, currency)}</p>
          </div>
          {m.qualifies ? (
            <Badge variant="success" className="gap-1"><CheckCircle2 className="h-3 w-3" /> Qualified</Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-amber-500/60 text-amber-700">
              <TrendingDown className="h-3 w-3" /> {formatCurrency(m.shortfall, currency)} short of {formatCurrency(quotaGross, currency)}
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
                <TableHead className="text-right">{isOverride ? `${overrideRatePct}%` : `${ratePct}%`}</TableHead>
                <TableHead>Status</TableHead>
                {showAction && (
                  <TableHead className="text-right">
                    <span className="inline-flex items-center gap-2">
                      {canManage && cardKeys.length > 0 && <CardTick dealKeys={cardKeys} />}
                      Action
                    </span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((d) => (
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
                  <TableCell>
                    <DealStatus deal={d} currency={currency} />
                  </TableCell>
                  {showAction && (
                    <TableCell className="text-right">
                      {/* The tick box sits in the row beside "Mark paid" — one
                          decision (this commission goes on a voucher) next to
                          the other (the money has changed hands).

                          They open at different times ON PURPOSE, which is the
                          owner's answer to the two of them disagreeing: the tick
                          opens on approval so a voucher can be prepared ahead,
                          and "Mark paid" opens five days before the release day
                          because that is when the cheque is actually cut. */}
                      <span className="inline-flex items-center justify-end gap-2">
                        {/* The eye: this row's proof of payment. Shown once the
                            commission has actually been paid — before that there
                            is no payment to evidence — to the three seats that
                            attach it and to the salesperson it pays. */}
                        {d.paid && (canAttachProof || d.salespersonId === viewerId) && (
                          <RowProof
                            kind={d.kind}
                            refId={d.refId}
                            payeeKind={d.payeeKind}
                            salespersonId={d.salespersonId}
                            docs={d.paymentProof as CommissionProofDoc[]}
                            canAttach={canAttachProof}
                          />
                        )}
                        {canManage && <DealTick dealKey={d.key} />}
                        {canManage && d.payNow ? (
                          <MarkPaid kind={d.kind} refId={d.refId} payeeKind={d.payeeKind} paid={d.paid} />
                        ) : canManage && d.approved && !d.paid ? (
                          <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                            Pay from {formatDate(d.payOpensYMD)}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* The month's money, always the month's — a search hides rows, it does
            not make a month earn less. Said in words while filtering, because a
            total that does not add up to the rows above it looks like a bug
            unless you are told why. */}
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t pt-3 text-sm">
          {searching && (
            <span className="mr-auto text-xs text-muted-foreground">Totals are for the whole month, not the matches.</span>
          )}
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

function DealStatus({ deal: d, currency }: { deal: SearchableDeal; currency: string }) {
  // Paid says what ACCOUNTING did; the stamp underneath says what the PAYEE
  // said. Two different people, so two different lines — see
  // `lib/commission-receipt`.
  if (d.paid) {
    return (
      <span className="inline-flex flex-col gap-0.5">
        <Badge variant="success" className="w-fit">Paid{d.paidByName ? ` · ${d.paidByName}` : ""}</Badge>
        <ReceivedStamp receivedAt={d.receivedAt} receivedByName={d.receivedByName} />
      </span>
    );
  }
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
