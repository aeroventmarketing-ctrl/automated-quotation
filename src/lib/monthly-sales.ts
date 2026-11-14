/**
 * Monthly sales history — the figure behind the Sales Dashboard's "Sales this
 * month" tile, for every month.
 *
 * The owner: *"Make the sales this month tile clickable, once click it will show
 * the monthly sales history with text and graph."*
 *
 * One rule for both: a CONFIRMED quotation books its full deal value
 * (`payableTotal`) on its recognition date (PO date on terms, else the first
 * payment), credited to its preparer; a COMPLETED counter sale books its total
 * on completion, credited to the salesperson (or recorder). The tile reads this
 * month's bucket of the same history, so the two can't disagree.
 */
import type { Prisma } from "@prisma/client";
import { saleFromClassification, isSaleConfirmed } from "@/lib/sale";
import { payableTotal } from "@/lib/quote";
import { saleRecognitionDate } from "@/lib/department-pnl";

export interface SaleEvent {
  at: Date;
  amount: number;
  person: string;
  kind: "quote" | "counter";
}

/** The month a sale is booked in — local calendar month, as the tile always counted. */
export const salesMonthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

type QuoteLike = {
  createdAt: Date;
  total: number | Prisma.Decimal;
  discountPct: number | Prisma.Decimal;
  vatMode: string;
  classification: unknown;
  preparedBy?: { name: string | null } | null;
};

/** A quotation's sale, or null when it isn't a confirmed sale. */
export function quoteSaleEvent(q: QuoteLike): SaleEvent | null {
  const sale = saleFromClassification(q.classification);
  if (!sale || !isSaleConfirmed(sale)) return null;
  const iso = saleRecognitionDate(sale);
  return {
    at: iso ? new Date(iso) : new Date(q.createdAt),
    // The discounted, VAT-adjusted amount the client pays.
    amount: payableTotal(q),
    person: q.preparedBy?.name ?? "—",
    kind: "quote",
  };
}

type CounterLike = { total: unknown; completedAt: Date | null; createdAt: Date; salespersonName: string | null; soldByName: string };

export function counterSaleEvent(cs: CounterLike): SaleEvent {
  return {
    at: new Date(cs.completedAt ?? cs.createdAt),
    amount: Number(cs.total) || 0,
    person: cs.salespersonName || cs.soldByName || "—",
    kind: "counter",
  };
}

export interface SalesMonth {
  /** YYYY-MM */
  key: string;
  /** "November 2026" */
  label: string;
  /** "Nov" (with "'26" when the chart spans years — see `short`). */
  short: string;
  total: number;
  quoteDeals: number;
  counterDeals: number;
  /** Percent vs the month before; null when that month had no sales. */
  change: number | null;
  top: { name: string; amount: number } | null;
  /** First and last day, YYYY-MM-DD — for the WON report link. */
  from: string;
  to: string;
}

export interface SalesHistory {
  /** Oldest first, every month from the first sale to `now` (empty months included). */
  months: SalesMonth[];
  thisMonth: SalesMonth | null;
  lastMonth: SalesMonth | null;
  best: SalesMonth | null;
  /** Sum and average of the 12 months ending with the last COMPLETE month. */
  last12: { total: number; average: number; months: number };
  /** This calendar year to date. */
  ytd: number;
  /** The same months of last year (Jan → this month). */
  ytdLastYear: number;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (now: number, before: number): number | null => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

function monthMeta(y: number, m0: number) {
  const key = `${y}-${String(m0 + 1).padStart(2, "0")}`;
  const last = new Date(y, m0 + 1, 0).getDate();
  return { key, label: `${MONTHS[m0]} ${y}`, short: MONTHS[m0].slice(0, 3), from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

export function buildSalesHistory(events: SaleEvent[], now: Date): SalesHistory {
  const nowKey = salesMonthKey(now);
  const bucket = new Map<string, { total: number; quote: number; counter: number; people: Map<string, number> }>();
  let firstKey = nowKey;
  for (const e of events) {
    if (!Number.isFinite(e.at.getTime())) continue;
    const k = salesMonthKey(e.at);
    if (k > nowKey) continue; // a sale dated ahead isn't history yet
    if (k < firstKey) firstKey = k;
    const b = bucket.get(k) ?? bucket.set(k, { total: 0, quote: 0, counter: 0, people: new Map() }).get(k)!;
    b.total += e.amount;
    if (e.kind === "quote") b.quote++;
    else b.counter++;
    b.people.set(e.person, (b.people.get(e.person) ?? 0) + e.amount);
  }

  const months: SalesMonth[] = [];
  let [y, m0] = [Number(firstKey.slice(0, 4)), Number(firstKey.slice(5, 7)) - 1];
  let prevTotal: number | null = null;
  for (;;) {
    const meta = monthMeta(y, m0);
    const b = bucket.get(meta.key);
    const total = round2(b?.total ?? 0);
    let top: SalesMonth["top"] = null;
    for (const [name, amount] of b?.people ?? []) if (!top || amount > top.amount) top = { name, amount: round2(amount) };
    months.push({ ...meta, total, quoteDeals: b?.quote ?? 0, counterDeals: b?.counter ?? 0, change: prevTotal == null ? null : pct(total, prevTotal), top });
    prevTotal = total;
    if (meta.key === nowKey) break;
    m0++;
    if (m0 === 12) ((m0 = 0), y++);
  }
  if (months.length > 1 && new Set(months.map((m) => m.key.slice(0, 4))).size > 1) {
    for (const m of months) m.short = `${m.short} '${m.key.slice(2, 4)}`;
  }

  const thisMonth = months[months.length - 1] ?? null;
  const lastMonth = months.length > 1 ? months[months.length - 2] : null;
  let best: SalesMonth | null = null;
  for (const m of months) if (m.total > 0 && (!best || m.total > best.total)) best = m;
  const complete = months.slice(0, -1).slice(-12);
  const last12Total = round2(complete.reduce((s, m) => s + m.total, 0));
  const year = nowKey.slice(0, 4);
  const lastYear = String(Number(year) - 1);
  const monthNo = nowKey.slice(5, 7);
  const ytd = round2(months.filter((m) => m.key.startsWith(year)).reduce((s, m) => s + m.total, 0));
  const ytdLastYear = round2(months.filter((m) => m.key.startsWith(lastYear) && m.key.slice(5, 7) <= monthNo).reduce((s, m) => s + m.total, 0));
  return {
    months,
    thisMonth,
    lastMonth,
    best,
    last12: { total: last12Total, average: complete.length ? round2(last12Total / complete.length) : 0, months: complete.length },
    ytd,
    ytdLastYear,
  };
}

/**
 * This month so far against last month — compared over the same number of days
 * would need daily data, so this states the plain totals and the share of last
 * month reached. e.g. "₱5,989,434.20 so far from 23 deals — 87% of October's ₱6.9M."
 */
export function shareOf(now: number, before: number): number | null {
  return before > 0 ? Math.round((now / before) * 100) : null;
}
