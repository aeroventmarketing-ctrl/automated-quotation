/**
 * Sales commissions — entitlement, not bookkeeping.
 *
 * The owner's rules, in their words (2026-09-02):
 *
 *   1. Sales should have a sale of more than 1 million pesos within the said date
 *   2. Clients must have a down payment from <month> for non-terms clients and
 *      submit PO within the said date if terms clients
 *   3. Clients should have fully paid the order amount regardless of date
 *   4. Once client fully paid, commission can be released every 15th and 30th of
 *      the month (full payment 1 Sept → payout 15 Sept)
 *   5. Automatically approve sales commission if the conditions above are met
 *   6. Sales commission is computed at 1.5% of gross sales less VAT
 *
 * Two of those are per-MONTH and four are per-DEAL, which is why this module
 * groups by salesperson × month rather than listing orders flat:
 *
 *   · Rule 2 dates a deal — `saleRecognitionDate` already encodes exactly the
 *     owner's split (terms → the PO date, everyone else → the first payment),
 *     so the sales month is that date's Manila month. No new date logic.
 *   · Rule 1 is a QUOTA on the month: the salesperson's confirmed sales
 *     recognised in that month must exceed ₱1,000,000 GROSS. Owner's call:
 *     the quota is the month's total (not per order) and is measured on the
 *     VAT-inclusive amount invoiced, even though the 1.5% is paid on the net.
 *     Below quota, NOTHING in that month is earned.
 *   · Rules 3 & 4 then release each deal individually, on its own full-payment
 *     date — so one month's commissions can pay out on several dates. They never
 *     pay out INSIDE the sales month, though: the owner's follow-up on Desiree's
 *     August — *"commission release start should be September 15, 2026 onwards
 *     until every client who purchased in August 2026 has paid"* — makes the
 *     15th of the following month a floor, because rule 1's target is a fact
 *     about a finished month. See `firstReleaseForMonth`.
 *
 * Nothing here writes. The figures are recomputed from the confirmed sales
 * themselves (the same source as the WON report and the P&L), so a deal that is
 * revised, part-paid or paid late is always current. The `Commission` table
 * stays what it has always been — the record of what was actually PAID OUT —
 * and is joined in for that one field.
 */
import { config } from "@/lib/config";
import { prisma } from "@/lib/db";
import { payableTotal, round2, readVatExemptTotal, vatModeChargesOutputVat } from "@/lib/quote";
import { saleFromClassification, isSaleConfirmed, collectedTotal, type SaleRecord } from "@/lib/sale";
import { saleRecognitionDate, manilaYMD } from "@/lib/department-pnl";

/** Rule 6 — the rate. */
export const COMMISSION_RATE_PCT = 1.5;
/** Rule 1 — the monthly quota, on GROSS (VAT-inclusive) sales. Strictly "more than". */
export const MONTHLY_QUOTA_GROSS = 1_000_000;

/** Money is equal to the cent; never compare Decimals-turned-floats exactly. */
const PESO_EPS = 0.005;

// --- Rule 6: the commission base ------------------------------------------

/**
 * Strip output VAT from a deal's gross — but only where the client was actually
 * charged VAT. The owner's ruling (2026-09-02): *"if order is VAT inclusive,
 * deduct vat amount to sales commission. If order is VAT Exclusive or Zero Rated
 * do not deduct VAT amount to sales commission."*
 *
 * The quotation has four VAT presentations, and the deciding question is whether
 * the payable amount CONTAINS VAT, not what the option is called:
 *
 *   VAT inclusive          → the price already contains VAT      → ÷ 1.12
 *   VAT exclusive (+12%)   → 12% is added on top, so it contains → ÷ 1.12
 *   VAT exclusive (÷1.12)  → the client pays the net, no VAT     → no deduction
 *   VAT exclusive zero rated → no output VAT at all              → no deduction
 *
 * The "+12%" mode is labelled *exclusive* but is confirmed by the owner to
 * deduct: the 12% on top is money the company remits to BIR, so paying 1.5% of
 * it would pay commission on the government's share. That is `vatModeChargesOutputVat`,
 * the same predicate the P&L and the Sales Summary use — do not swap it for a
 * name check on "EXCLUSIVE".
 *
 * Flat VAT-exempt lines (KDK / jet fans) carry no VAT and stay at face value.
 * Their share is pro-rated off the quote's own total, because `gross` here is the
 * payable total — already through the quote's mark-up / discount.
 */
export function netOfVat(
  q: { total: number | { toString(): string }; vatMode: string; classification?: unknown },
  gross: number,
  vatRate = config.vatRate,
): number {
  if (!vatModeChargesOutputVat(q.vatMode)) return round2(gross);
  const listed = Number(q.total);
  const flat = Math.min(readVatExemptTotal(q.classification), listed);
  const exemptShare = listed > 0 ? flat / listed : 0;
  const exemptPart = gross * exemptShare;
  return round2(exemptPart + (gross - exemptPart) / (1 + vatRate));
}

/** Rule 6 — 1.5% of the net. */
export const commissionOn = (net: number): number => round2((net * COMMISSION_RATE_PCT) / 100);

// --- Rule 4: the payout calendar ------------------------------------------

const daysInMonth = (year: number, month1: number) => new Date(year, month1, 0).getDate();

/**
 * Rule 4 — commissions are released on the 15th and the 30th. Given the day the
 * client's money fully landed, this is the first release date ON OR AFTER it:
 * paid 1 Sept → 15 Sept; paid 15 Sept → 15 Sept; paid 16 Sept → 30 Sept;
 * paid 31 Oct → 15 Nov.
 *
 * February has no 30th, so its second release is the last day of the month —
 * the payroll never skips a cycle just because the calendar is short.
 *
 * @param fullyPaidYMD Manila calendar day (YYYY-MM-DD) the order was fully paid.
 */
export function payoutDateFor(fullyPaidYMD: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fullyPaidYMD);
  if (!m) return fullyPaidYMD;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const pad = (n: number) => String(n).padStart(2, "0");
  if (d <= 15) return `${y}-${pad(mo)}-15`;
  const second = Math.min(30, daysInMonth(y, mo));
  if (d <= second) return `${y}-${pad(mo)}-${pad(second)}`;
  // Past the last release of a 31-day month → the 15th of the next one.
  return mo === 12 ? `${y + 1}-01-15` : `${y}-${pad(mo + 1)}-15`;
}

/**
 * Rule 4's FLOOR: nothing from a sales month can be released before the **15th of
 * the month after it**.
 *
 * Owner (2026-09-02), on Desiree's August: *"Desiree meet the target on August
 * 2026, commission release start should be September 15, 2026 onwards until every
 * client who purchased in August 2026 has paid."*
 *
 * The reason is rule 1: the ₱1,000,000 target is a fact about a whole month, and
 * a month in progress hasn't got one yet. Releasing on a date inside August would
 * be paying out against a total still being added to. So August's commissions
 * start on 15 September and trickle on from there as each client settles — a
 * client who pays in October releases on October's own 15th or 30th.
 *
 * @param salesMonth Manila YYYY-MM the deal was recognised in (rule 2).
 */
export function firstReleaseForMonth(salesMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(salesMonth);
  if (!m) return salesMonth;
  const [y, mo] = [Number(m[1]), Number(m[2])];
  return mo === 12 ? `${y + 1}-01-15` : `${y}-${String(mo + 1).padStart(2, "0")}-15`;
}

/**
 * The release date for one deal: the later of its own next 15th/30th and its
 * sales month's floor. Both are already valid release days, so the later of the
 * two is too — YYYY-MM-DD compares correctly as text.
 */
export const releaseDateFor = (fullyPaidYMD: string, salesMonth: string): string => {
  const own = payoutDateFor(fullyPaidYMD);
  const floor = firstReleaseForMonth(salesMonth);
  return own > floor ? own : floor;
};

// --- Rule 3: when the money was all in ------------------------------------

/**
 * The Manila day a confirmed sale became fully paid, or null if it is not. EWT
 * counts as collected (the client withheld it and remits it to BIR), exactly as
 * `collectedTotal` has always treated it — the deal value is settled either way.
 *
 * The date is the LAST payment that took the balance to zero, not the first.
 */
export function fullyPaidOn(sale: SaleRecord | null, gross: number): string | null {
  if (!sale || gross <= 0) return null;
  if (collectedTotal(sale) < gross - PESO_EPS) return null;
  const dates = (sale.payments ?? []).map((p) => p.date).filter(Boolean).sort();
  const last = dates[dates.length - 1];
  return last ? manilaYMD(last) : null;
}

// --- The view -------------------------------------------------------------

export type CommissionDealKind = "order" | "counter";

/** How rule 2 dated this deal — shown so the month is never a mystery. */
export type CommissionBasis = "po" | "payment" | "counter";

export interface CommissionDeal {
  kind: CommissionDealKind;
  refId: string;
  refLabel: string;
  href: string;
  company: string;
  salespersonId: string;
  salespersonName: string;
  /** Rule 2 — Manila YYYY-MM of the recognition date. */
  salesMonth: string;
  recognisedYMD: string;
  basis: CommissionBasis;
  /** VAT-inclusive deal value — what rule 1's quota counts. */
  gross: number;
  /** Rule 6's base: gross less VAT (= gross when the deal charged no output VAT). */
  net: number;
  /** Whether VAT was actually deducted — false for a VAT-exclusive / zero-rated deal. */
  vatDeducted: boolean;
  collected: number;
  /** Rule 3. */
  fullyPaid: boolean;
  fullyPaidYMD: string | null;
  /** Rule 6 — 1.5% of net. Earned only when the month qualifies AND it is fully paid. */
  amount: number;
  /** Rule 4 — null until fully paid. */
  payoutYMD: string | null;
  /** Rule 5 — the month cleared the quota and the client has fully paid. */
  approved: boolean;
  /** Already paid out (from the Commission table). */
  paid: boolean;
  paidAt: string | null;
  paidByName: string | null;
  commissionId: string | null;
}

export interface CommissionMonth {
  salespersonId: string;
  salespersonName: string;
  /** YYYY-MM. */
  salesMonth: string;
  /** Rule 1 — every confirmed sale recognised in this month, gross. */
  monthGross: number;
  /** Rule 1 — monthGross > ₱1,000,000. */
  qualifies: boolean;
  /** How far short of the quota (0 once it qualifies). */
  shortfall: number;
  deals: CommissionDeal[];
  /** 1.5% of net across the deals that are approved (rule 5) — earned, paid or not. */
  earned: number;
  paid: number;
  unpaid: number;
  /** Approved but not yet paid, and the earliest payout date among them. */
  nextPayoutYMD: string | null;
}

export interface CommissionsView {
  months: CommissionMonth[];
  totals: { earned: number; paid: number; unpaid: number; dealCount: number; approvedCount: number };
  currency: string;
}

/** A deal that has cleared every rule and is waiting for the money to go out. */
export const isPayable = (d: CommissionDeal): boolean => d.approved && !d.paid;

/**
 * Group the deals salesperson × month and apply the rules: rule 1 to the group,
 * rules 3–6 to each deal inside it. Mutates the deals it is given (they are
 * built for this) and returns the months, newest first.
 *
 * Split out of `buildCommissions` so the entitlement rules — the part that
 * decides who gets paid — are testable without a database.
 */
export function groupByPersonMonth(deals: CommissionDeal[]): CommissionMonth[] {
  const groups = new Map<string, CommissionMonth>();
  for (const d of deals) {
    d.fullyPaid = d.fullyPaidYMD != null;
    const key = `${d.salespersonId}::${d.salesMonth}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        salespersonId: d.salespersonId, salespersonName: d.salespersonName, salesMonth: d.salesMonth,
        monthGross: 0, qualifies: false, shortfall: 0, deals: [],
        earned: 0, paid: 0, unpaid: 0, nextPayoutYMD: null,
      };
      groups.set(key, g);
    }
    g.deals.push(d);
    g.monthGross = round2(g.monthGross + d.gross);
  }

  for (const g of groups.values()) {
    // Rule 1 — strictly MORE than ₱1M, on the month's GROSS. A month that misses
    // the quota earns nothing at all, however much of it the clients have paid.
    g.qualifies = g.monthGross > MONTHLY_QUOTA_GROSS;
    g.shortfall = g.qualifies ? 0 : round2(MONTHLY_QUOTA_GROSS - g.monthGross);
    for (const d of g.deals) {
      // Rule 5 — no one approves this; clearing rules 1–3 IS the approval.
      d.approved = g.qualifies && d.fullyPaid;
      d.amount = d.approved ? commissionOn(d.net) : 0;
      // Rule 4 — a release date exists as soon as the client has fully paid, even
      // while the month is short of quota, so Sales can see what it would be. It
      // is never inside the sales month itself: the month's ₱1M target isn't a
      // fact until the month ends, so the floor is the 15th of the month after.
      d.payoutYMD = d.fullyPaidYMD ? releaseDateFor(d.fullyPaidYMD, g.salesMonth) : null;
    }
    g.deals.sort((a, b) => a.recognisedYMD.localeCompare(b.recognisedYMD) || a.refLabel.localeCompare(b.refLabel));
    g.earned = round2(g.deals.reduce((a, d) => a + d.amount, 0));
    g.paid = round2(g.deals.filter((d) => d.paid).reduce((a, d) => a + d.amount, 0));
    g.unpaid = round2(g.earned - g.paid);
    const due = g.deals.filter(isPayable).map((d) => d.payoutYMD!).sort();
    g.nextPayoutYMD = due[0] ?? null;
  }

  return [...groups.values()].sort(
    (a, b) => b.salesMonth.localeCompare(a.salesMonth) || a.salespersonName.localeCompare(b.salespersonName),
  );
}

// --- The build ------------------------------------------------------------

type BuildOptions = {
  /** Only this salesperson (Sales viewing their own). */
  salespersonId?: string;
};

// Deliberately NOT gated by the alert go-live floor. That gate exists to silence
// a pre-launch backlog of *alerts*; a commission is money someone earned, and
// hiding it because the deal predates the launch date would quietly under-pay
// them. The WON report and the P&L read the whole history for the same reason.

/**
 * Build the commissions view: every confirmed sale, grouped salesperson × month,
 * with rules 1–6 applied. Reads only.
 */
export async function buildCommissions(opts: BuildOptions = {}): Promise<CommissionsView> {
  const [quotations, counterSales, paidRows] = await Promise.all([
    prisma.quotation.findMany({
      // Rule 1 needs the salesperson's WHOLE month, so this can be narrowed to
      // one salesperson but never to one order.
      where: opts.salespersonId ? { preparedById: opts.salespersonId } : undefined,
      select: {
        id: true,
        quoteNumber: true,
        classification: true,
        total: true,
        discountPct: true,
        vatMode: true,
        currency: true,
        preparedById: true,
        preparedBy: { select: { name: true } },
        inquiry: { select: { customer: { select: { company: true } } } },
      },
    }),
    prisma.counterSale
      .findMany({
        where: { status: "COMPLETED" },
        select: {
          id: true, saleNumber: true, total: true, subtotal: true, amountPaid: true,
          paymentCleared: true, clearedAt: true, completedAt: true, createdAt: true,
          salespersonId: true, salespersonName: true, soldById: true, soldByName: true,
          customer: { select: { company: true } },
        },
      })
      .catch(() => [] as never[]),
    // The payout record. Missing table (pre-migration) must not blank the page.
    prisma.commission
      .findMany({ select: { id: true, quotationId: true, counterSaleId: true, paid: true, paidAt: true, paidByName: true } })
      .catch(() => [] as { id: string; quotationId: string | null; counterSaleId: string | null; paid: boolean; paidAt: Date | null; paidByName: string | null }[]),
  ]);

  const payout = new Map(
    paidRows.map((c) => [c.quotationId ? `q:${c.quotationId}` : `c:${c.counterSaleId}`, c] as const),
  );
  const currency = quotations.find((q) => q.currency)?.currency ?? "PHP";
  const deals: CommissionDeal[] = [];

  for (const q of quotations) {
    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;
    // Rule 2 — the PO date on terms, the first payment otherwise.
    const recognised = saleRecognitionDate(sale);
    if (!recognised) continue;
    const recognisedYMD = manilaYMD(recognised);

    const gross = round2(payableTotal(q));
    const net = netOfVat(q, gross);
    const record = payout.get(`q:${q.id}`);
    deals.push({
      kind: "order",
      refId: q.id,
      refLabel: q.quoteNumber,
      href: `/orders/${q.id}`,
      company: q.inquiry?.customer?.company ?? "—",
      salespersonId: q.preparedById,
      salespersonName: q.preparedBy?.name ?? "—",
      salesMonth: recognisedYMD.slice(0, 7),
      recognisedYMD,
      basis: sale.arrangement === "terms" ? "po" : "payment",
      gross,
      net,
      vatDeducted: net < gross - PESO_EPS,
      collected: round2(collectedTotal(sale)),
      fullyPaid: false, // filled below (needs fullyPaidOn)
      fullyPaidYMD: fullyPaidOn(sale, gross),
      amount: 0,
      payoutYMD: null,
      approved: false,
      paid: record?.paid ?? false,
      paidAt: record?.paidAt ? record.paidAt.toISOString() : null,
      paidByName: record?.paidByName ?? null,
      commissionId: record?.id ?? null,
    });
  }

  for (const cs of counterSales) {
    // A walk-in is credited to the named salesperson, else whoever recorded it.
    const salespersonId = cs.salespersonId ?? cs.soldById;
    if (opts.salespersonId && salespersonId !== opts.salespersonId) continue;
    const dated = cs.completedAt ?? cs.createdAt;
    const recognisedYMD = manilaYMD(dated.toISOString());
    const gross = round2(Number(cs.total));
    // A counter sale carries its own net (`subtotal`), which `counterTotals`
    // already computes by the same rule: total ÷ 1.12 when VAT-inclusive, and
    // total unchanged when VAT-exclusive or zero-rated.
    const net = round2(Number(cs.subtotal) || gross);
    // Rule 3 for a walk-in: the money has cleared (cash clears on the spot; a
    // post-dated cheque does not until Accounting says so).
    const cleared = cs.paymentCleared && Number(cs.amountPaid) >= gross - PESO_EPS;
    const record = payout.get(`c:${cs.id}`);
    deals.push({
      kind: "counter",
      refId: cs.id,
      refLabel: cs.saleNumber ?? "Counter sale",
      href: `/counter-sales/${cs.id}`,
      company: cs.customer?.company ?? "—",
      salespersonId,
      salespersonName: cs.salespersonName || cs.soldByName || "—",
      salesMonth: recognisedYMD.slice(0, 7),
      recognisedYMD,
      basis: "counter",
      gross,
      net,
      vatDeducted: net < gross - PESO_EPS,
      collected: round2(Number(cs.amountPaid)),
      fullyPaid: false,
      fullyPaidYMD: cleared ? manilaYMD((cs.clearedAt ?? dated).toISOString()) : null,
      amount: 0,
      payoutYMD: null,
      approved: false,
      paid: record?.paid ?? false,
      paidAt: record?.paidAt ? record.paidAt.toISOString() : null,
      paidByName: record?.paidByName ?? null,
      commissionId: record?.id ?? null,
    });
  }

  const months = groupByPersonMonth(deals);

  return {
    months,
    totals: {
      earned: round2(months.reduce((a, g) => a + g.earned, 0)),
      paid: round2(months.reduce((a, g) => a + g.paid, 0)),
      unpaid: round2(months.reduce((a, g) => a + g.unpaid, 0)),
      dealCount: deals.length,
      approvedCount: deals.filter((d) => d.approved).length,
    },
    currency,
  };
}

/** Every deal across the view, flattened — for totals and lookups. */
export const allDeals = (view: CommissionsView): CommissionDeal[] => view.months.flatMap((m) => m.deals);
