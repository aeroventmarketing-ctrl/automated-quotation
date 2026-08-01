/**
 * WON-inquiries sales report — the deals each salesperson closed in a date range,
 * grouped and subtotalled per salesperson. Shared by the on-screen/print view,
 * the Excel and PDF exports, and the email sender so all four stay in sync.
 *
 * The date range is on the inquiry's creation date (the "Created" column shown on
 * the Inquiries tab), bounded in Manila time. "Value" is the deal value of the
 * inquiry's confirmed sale(s) (payableTotal), and "Collected" what's been paid.
 */
import { prisma } from "@/lib/db";
import { payableTotal, round2 } from "@/lib/quote";
import { saleFromClassification, isSaleConfirmed, collectedTotal } from "@/lib/sale";

export interface SalesReportRow {
  inquiryId: string;
  company: string;
  source: string;
  dateISO: string;
  quotes: number;
  value: number; // deal value (VAT-inclusive), confirmed sale(s)
  collected: number;
  balance: number;
}
export interface SalesReportGroup {
  salesperson: string;
  rows: SalesReportRow[];
  count: number;
  value: number;
  collected: number;
  balance: number;
}
export interface SalesReport {
  from: string;
  to: string;
  groups: SalesReportGroup[];
  totals: { count: number; value: number; collected: number; balance: number };
  currency: string;
}

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Build the per-salesperson WON report for [from, to] (YYYY-MM-DD, Manila). */
export async function buildSalesReport(from: string, to: string): Promise<SalesReport> {
  if (!isYmd(from) || !isYmd(to)) throw new Error("Invalid date range.");
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  // Manila (UTC+8) day bounds so a whole calendar day is included.
  const start = new Date(`${lo}T00:00:00.000+08:00`);
  const end = new Date(`${hi}T23:59:59.999+08:00`);

  const inquiries = await prisma.inquiry.findMany({
    where: { status: "WON", createdAt: { gte: start, lte: end } },
    select: {
      id: true,
      createdAt: true,
      source: true,
      customer: { select: { company: true } },
      createdBy: { select: { name: true } },
      quotations: { select: { classification: true, total: true, discountPct: true, vatMode: true, currency: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const currency = inquiries.flatMap((i) => i.quotations).find((q) => q.currency)?.currency ?? "PHP";
  const byPerson = new Map<string, SalesReportRow[]>();
  for (const inq of inquiries) {
    let value = 0;
    let collected = 0;
    for (const q of inq.quotations) {
      const sale = saleFromClassification(q.classification);
      if (!sale || !isSaleConfirmed(sale)) continue;
      value = round2(value + payableTotal(q));
      collected = round2(collected + collectedTotal(sale));
    }
    const row: SalesReportRow = {
      inquiryId: inq.id,
      company: inq.customer.company,
      source: String(inq.source),
      dateISO: inq.createdAt.toISOString(),
      quotes: inq.quotations.length,
      value,
      collected,
      balance: round2(Math.max(0, value - collected)),
    };
    const key = inq.createdBy.name || "—";
    (byPerson.get(key) ?? byPerson.set(key, []).get(key)!).push(row);
  }

  const groups: SalesReportGroup[] = [...byPerson.entries()]
    .map(([salesperson, rows]) => ({
      salesperson,
      rows,
      count: rows.length,
      value: round2(rows.reduce((a, r) => a + r.value, 0)),
      collected: round2(rows.reduce((a, r) => a + r.collected, 0)),
      balance: round2(rows.reduce((a, r) => a + r.balance, 0)),
    }))
    .sort((a, b) => a.salesperson.localeCompare(b.salesperson));

  const totals = {
    count: groups.reduce((a, g) => a + g.count, 0),
    value: round2(groups.reduce((a, g) => a + g.value, 0)),
    collected: round2(groups.reduce((a, g) => a + g.collected, 0)),
    balance: round2(groups.reduce((a, g) => a + g.balance, 0)),
  };

  return { from: lo, to: hi, groups, totals, currency };
}
