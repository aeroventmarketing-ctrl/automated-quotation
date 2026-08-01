/**
 * WON sales report — the deals each salesperson closed in a date range, one row
 * per confirmed order (won quotation), grouped and subtotalled per salesperson.
 * Shared by the on-screen/print view, the Excel and PDF exports, and the email
 * sender so all four stay in sync.
 *
 * Sourced from CONFIRMED SALES — the same signal the Departmental P&L uses (a
 * quotation whose sale is confirmed), NOT the inquiry's `status` field. That
 * status can lag reality (e.g. a revision reopens the quote to DRAFT), so keying
 * off it silently dropped genuinely-won deals; the two surfaces now reconcile.
 * One row per confirmed quotation, credited to its preparer.
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
  quotationId: string;
  quoteNumber: string;
  company: string;
  source: string;
  dateISO: string;
  value: number; // deal value (VAT-inclusive) of this order
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

  // Every quotation; we keep the ones with a confirmed sale (same as the P&L).
  // The report date depends on the quotation/basis (not a single indexed column),
  // so it's filtered in memory after being computed.
  const quotations = await prisma.quotation.findMany({
    select: {
      id: true,
      quoteNumber: true,
      classification: true,
      total: true,
      discountPct: true,
      vatMode: true,
      currency: true,
      createdAt: true,
      preparedBy: { select: { name: true } },
      inquiry: { select: { source: true, customer: { select: { company: true } }, createdBy: { select: { name: true } } } },
    },
  });

  const currency = quotations.find((q) => q.currency)?.currency ?? "PHP";
  const byPerson = new Map<string, SalesReportRow[]>();
  // One row per CONFIRMED order (won quotation) — a customer with several orders
  // shows each on its own date, credited to that quotation's preparer.
  for (const q of quotations) {
    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;

    // The date this order is booked on, per the chosen basis.
    const dateISO = basis === "won" ? saleRecognitionDate(sale) : quoteCreatedISO(q);
    if (!dateISO) continue; // "won" with no payment date yet → not booked
    const ymd = manilaYMD(dateISO);
    if (ymd < lo || ymd > hi) continue;

    const value = round2(payableTotal(q));
    const collected = round2(collectedTotal(sale));
    const row: SalesReportRow = {
      quotationId: q.id,
      quoteNumber: q.quoteNumber,
      company: q.inquiry?.customer?.company ?? "—",
      source: q.inquiry?.source ? String(q.inquiry.source) : "—",
      dateISO,
      value,
      collected,
      balance: round2(Math.max(0, value - collected)),
    };
    const key = q.preparedBy?.name || q.inquiry?.createdBy?.name || "—";
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
