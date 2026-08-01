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
import { saleRecognitionDate, manilaYMD } from "@/lib/department-pnl";

/**
 * Which date a won inquiry is dated by:
 *  - "created": the WON quotation's creation date; for a revised quote, the date
 *    the revision was opened (classification.revisedAt), else the quote's createdAt.
 *  - "won": the sale's payment / PO recognition date.
 */
export type ReportBasis = "created" | "won";
export const REPORT_BASIS_LABEL: Record<ReportBasis, string> = { created: "Quotation date", won: "Payment date" };

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
  basis: ReportBasis;
  groups: SalesReportGroup[];
  totals: { count: number; value: number; collected: number; balance: number };
  currency: string;
}

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The quotation's effective creation date — the revision date if it was revised. */
function quoteCreatedISO(q: { classification: unknown; createdAt: Date }): string {
  const revisedAt = (q.classification as Record<string, unknown> | null)?.revisedAt;
  return typeof revisedAt === "string" ? revisedAt : q.createdAt.toISOString();
}

/** Build the per-salesperson WON report for [from, to] (YYYY-MM-DD, Manila). */
export async function buildSalesReport(from: string, to: string, basis: ReportBasis = "created"): Promise<SalesReport> {
  if (!isYmd(from) || !isYmd(to)) throw new Error("Invalid date range.");
  const [lo, hi] = from <= to ? [from, to] : [to, from];

  // WON is a bounded set; the report date depends on the quotation/basis (not a
  // single indexed column), so filter the range in memory after computing it.
  const inquiries = await prisma.inquiry.findMany({
    where: { status: "WON" },
    select: {
      id: true,
      createdAt: true,
      source: true,
      customer: { select: { company: true } },
      createdBy: { select: { name: true } },
      quotations: { select: { classification: true, total: true, discountPct: true, vatMode: true, currency: true, createdAt: true } },
    },
  });

  const currency = inquiries.flatMap((i) => i.quotations).find((q) => q.currency)?.currency ?? "PHP";
  const byPerson = new Map<string, SalesReportRow[]>();
  for (const inq of inquiries) {
    const confirmed = inq.quotations.filter((q) => {
      const s = saleFromClassification(q.classification);
      return !!s && isSaleConfirmed(s);
    });
    let value = 0;
    let collected = 0;
    for (const q of confirmed) {
      value = round2(value + payableTotal(q));
      collected = round2(collected + collectedTotal(saleFromClassification(q.classification)));
    }

    // The date this won inquiry is booked on, per the chosen basis.
    let dateISO: string | null = null;
    if (basis === "won") {
      const recs = confirmed
        .map((q) => saleRecognitionDate(saleFromClassification(q.classification)))
        .filter((d): d is string => !!d)
        .sort();
      dateISO = recs[0] ?? null; // earliest payment / PO date
    } else {
      const pool = confirmed.length ? confirmed : inq.quotations;
      const dates = pool.map(quoteCreatedISO).sort();
      dateISO = dates[dates.length - 1] ?? inq.createdAt.toISOString(); // latest revision's date
    }
    if (!dateISO) continue; // "won" with no payment date yet → not booked
    const ymd = manilaYMD(dateISO);
    if (ymd < lo || ymd > hi) continue;

    const row: SalesReportRow = {
      inquiryId: inq.id,
      company: inq.customer.company,
      source: String(inq.source),
      dateISO,
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
      rows: rows.sort((a, b) => a.dateISO.localeCompare(b.dateISO)),
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

  return { from: lo, to: hi, basis, groups, totals, currency };
}
