/**
 * Sales Summary (Vatable) — a BIR-style output-VAT register: one row per
 * confirmed VATABLE order (a quotation whose sale is confirmed and whose VAT
 * mode charges output VAT), booked on its PAYMENT date. Mirrors the WON sales
 * report's on-screen/print behaviour and date range, but lists the closing
 * documents (Sales Invoice / Collection Receipt / Delivery Receipt numbers) with
 * the client's TIN, PO amount and EWT withheld — the columns Accounting files.
 *
 * Sourced from CONFIRMED SALES (same signal as the P&L / WON report), dated by
 * the sale's payment / recognition date. The SI / CR / DR numbers come from the
 * AI reads captured on each closing document (classification.saleDocReads); the
 * TIN rides in the account registry (the Customer table has no TIN column).
 */
import { prisma } from "@/lib/db";
import { payableTotal, round2, vatModeChargesOutputVat } from "@/lib/quote";
import {
  saleFromClassification,
  isSaleConfirmed,
  ewtWithheld,
  saleDocReadsFromClassification,
  isSaleDocCleared,
  type SaleDocReadStamp,
} from "@/lib/sale";
import { saleRecognitionDate, manilaYMD } from "@/lib/department-pnl";
import { getAccountsRegistry } from "@/lib/account";

export interface SalesSummaryRow {
  /** Quotation id, or counter-sale id — unique within the report either way. */
  id: string;
  /** Where this sale came from. A walk-in has no quotation behind it. */
  kind: "order" | "counter";
  /** Quote number, or the counter sale's number (CS-2026-00010). */
  reference: string;
  dateISO: string; // payment / recognition date
  siNumber: string; // Sales Invoice No.
  crNumber: string; // Collection Receipt (OR / CR / AF) No.
  drNumber: string; // Delivery Receipt No.
  company: string;
  tin: string;
  poAmount: number; // VAT-inclusive deal value
  ewt: number; // EWT withheld (final payment)
  address: string;
}
export interface SalesSummary {
  from: string;
  to: string;
  rows: SalesSummaryRow[];
  totals: { count: number; poAmount: number; ewt: number };
  currency: string;
}

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Pick the captured document number for a slot key — a cleared read wins. */
function docNumberFor(reads: Record<string, SaleDocReadStamp>, docKey: string): string {
  const stamps = Object.values(reads).filter((s) => s.docKey === docKey && s.documentNumber);
  if (stamps.length === 0) return "";
  const cleared = stamps.find((s) => isSaleDocCleared(s));
  return (cleared ?? stamps[stamps.length - 1]).documentNumber ?? "";
}

/**
 * The client's TIN as read off the closing documents — the Sales Invoice wins,
 * then the Collection Receipt, then the Delivery Receipt (a cleared read first).
 * Returns "" when no document carried a TIN.
 */
function tinFromReads(reads: Record<string, SaleDocReadStamp>): string {
  for (const docKey of ["sales_invoice", "or_cr_af", "delivery_receipt"]) {
    const stamps = Object.values(reads).filter((s) => s.docKey === docKey && s.customerTin);
    if (stamps.length === 0) continue;
    const cleared = stamps.find((s) => isSaleDocCleared(s));
    const tin = ((cleared ?? stamps[stamps.length - 1]).customerTin ?? "").trim();
    if (tin) return tin;
  }
  return "";
}

/**
 * The EWT withheld as read off the Collection Receipt's settlement box (a
 * cleared read wins). Null when no read carried an EWT amount.
 */
function ewtFromReads(reads: Record<string, SaleDocReadStamp>): number | null {
  const stamps = Object.values(reads).filter((s) => s.docKey === "or_cr_af" && s.ewtAmount != null && s.ewtAmount > 0);
  if (stamps.length === 0) return null;
  const cleared = stamps.find((s) => isSaleDocCleared(s));
  return (cleared ?? stamps[stamps.length - 1]).ewtAmount;
}

/**
 * The walk-in half of the register.
 *
 * The owner, 15 September: *"Counter sales not showing in Sales Summary
 * vatable."* They never had: this report read `Quotation` and nothing else, and
 * a counter sale lives in its own table with no quotation behind it. A VATable
 * walk-in is output VAT the company owes exactly like any other sale, so its
 * absence from a BIR register was a hole in the filing, not a display quirk.
 *
 * ## What counts, and when
 *
 * **Every COMPLETED sale** — not only the ones whose money has cleared. This is
 * deliberately a looser test than the orders above use, because a counter sale
 * is a different animal. An order is not a sale until it is confirmed and paid;
 * a counter sale that reads COMPLETED has already handed the goods over the
 * counter and recorded the full amount as paid. `paymentCleared` only tracks
 * whether a cheque or a GCash transfer has landed since, and a cheque in the
 * drawer does not un-sell the goods or un-owe the output VAT.
 *
 * It is also the safer way to be wrong. A sale that appears in a VAT register
 * and shouldn't is a line Accounting can see and argue with; a sale that never
 * appears is a hole in a filing nobody notices — which is exactly what was
 * reported. VOID sales are excluded, because those really were un-sold.
 *
 * **Dated by the payment**, like the rest of the report: `clearedAt` when the
 * money landed later, otherwise when the sale was completed.
 *
 * A counter sale carries no captured document numbers (there is no AI read on
 * its attachments), so SI / CR / DR come through blank and the sale's own number
 * identifies the row. A blank column on a row that exists beats a missing row.
 */
async function counterSaleRows(
  lo: string,
  hi: string,
  accounts: Awaited<ReturnType<typeof getAccountsRegistry>>,
): Promise<SalesSummaryRow[]> {
  const sales = await prisma.counterSale
    .findMany({
      where: { status: "COMPLETED" },
      select: {
        id: true, saleNumber: true, vatMode: true, total: true,
        clearedAt: true, completedAt: true, createdAt: true,
        customerId: true,
        customer: { select: { company: true, address: true } },
      },
    })
    .catch(() => [] as never[]);

  const rows: SalesSummaryRow[] = [];
  for (const cs of sales) {
    // Vatable only, on the same test the orders use. A counter sale's
    // "EXCLUSIVE" charges no VAT at all (`counterTotals` returns vat: 0), so it
    // is correctly out.
    if (!vatModeChargesOutputVat(cs.vatMode)) continue;
    const gross = round2(Number(cs.total));
    const paidAt = cs.clearedAt ?? cs.completedAt ?? cs.createdAt;
    if (!paidAt) continue;
    const dateISO = paidAt.toISOString();
    const ymd = manilaYMD(dateISO);
    if (ymd < lo || ymd > hi) continue;

    rows.push({
      id: cs.id,
      kind: "counter",
      reference: cs.saleNumber ?? "Counter sale",
      dateISO,
      siNumber: "",
      crNumber: "",
      drNumber: "",
      company: cs.customer?.company ?? "—",
      tin: (cs.customerId && accounts[cs.customerId]?.tin) || "",
      poAmount: gross,
      // No EWT at the counter: a walk-in pays the full price in cash or its
      // equivalent, and withholding is a thing corporate clients do on terms.
      ewt: 0,
      address: cs.customer?.address ?? "",
    });
  }
  return rows;
}

/**
 * Build the Sales Summary (Vatable) for [from, to] (YYYY-MM-DD, Manila) — always
 * on the PAYMENT-date basis. Orders AND counter sales: both are output VAT.
 */
export async function buildSalesSummary(from: string, to: string): Promise<SalesSummary> {
  if (!isYmd(from) || !isYmd(to)) throw new Error("Invalid date range.");
  const [lo, hi] = from <= to ? [from, to] : [to, from];

  const [quotations, accounts] = await Promise.all([
    prisma.quotation.findMany({
      select: {
        id: true,
        quoteNumber: true,
        classification: true,
        total: true,
        discountPct: true,
        vatMode: true,
        currency: true,
        inquiry: {
          select: { customerId: true, customer: { select: { company: true, address: true } } },
        },
      },
    }),
    getAccountsRegistry(),
  ]);

  const currency = quotations.find((q) => q.currency)?.currency ?? "PHP";
  const rows: SalesSummaryRow[] = [];

  for (const q of quotations) {
    // Vatable only — the deal charges the client output VAT (INCLUSIVE /
    // EXCLUSIVE_PLUS); zero-rated / exempt orders are excluded.
    if (!vatModeChargesOutputVat(q.vatMode)) continue;

    const sale = saleFromClassification(q.classification);
    if (!sale || !isSaleConfirmed(sale)) continue;

    const dateISO = saleRecognitionDate(sale); // payment date
    if (!dateISO) continue;
    const ymd = manilaYMD(dateISO);
    if (ymd < lo || ymd > hi) continue;

    const reads = saleDocReadsFromClassification(q.classification);
    const customerId = q.inquiry?.customerId ?? "";
    rows.push({
      id: q.id,
      kind: "order",
      reference: q.quoteNumber,
      dateISO,
      siNumber: docNumberFor(reads, "sales_invoice"),
      crNumber: docNumberFor(reads, "or_cr_af"),
      drNumber: docNumberFor(reads, "delivery_receipt"),
      company: q.inquiry?.customer?.company ?? "—",
      // Prefer the TIN read off this order's closing documents; fall back to the
      // client's saved TIN.
      tin: tinFromReads(reads) || (customerId && accounts[customerId]?.tin) || "",
      poAmount: round2(payableTotal(q)),
      // Prefer the EWT read off the Collection Receipt's settlement box; fall
      // back to the EWT payment lines recorded on the order.
      ewt: round2(ewtFromReads(reads) ?? ewtWithheld(sale)),
      address: q.inquiry?.customer?.address ?? "",
    });
  }

  rows.push(...(await counterSaleRows(lo, hi, accounts)));
  rows.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.reference.localeCompare(b.reference));

  const totals = {
    count: rows.length,
    poAmount: round2(rows.reduce((a, r) => a + r.poAmount, 0)),
    ewt: round2(rows.reduce((a, r) => a + r.ewt, 0)),
  };

  return { from: lo, to: hi, rows, totals, currency };
}
