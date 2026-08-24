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
  quotationId: string;
  quoteNumber: string;
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
 * Build the Sales Summary (Vatable) for [from, to] (YYYY-MM-DD, Manila) — always
 * on the PAYMENT-date basis.
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
      quotationId: q.id,
      quoteNumber: q.quoteNumber,
      dateISO,
      siNumber: docNumberFor(reads, "sales_invoice"),
      crNumber: docNumberFor(reads, "or_cr_af"),
      drNumber: docNumberFor(reads, "delivery_receipt"),
      company: q.inquiry?.customer?.company ?? "—",
      // Prefer the TIN read off this order's closing documents; fall back to the
      // client's saved TIN.
      tin: tinFromReads(reads) || (customerId && accounts[customerId]?.tin) || "",
      poAmount: round2(payableTotal(q)),
      ewt: round2(ewtWithheld(sale)),
      address: q.inquiry?.customer?.address ?? "",
    });
  }

  rows.sort((a, b) => a.dateISO.localeCompare(b.dateISO) || a.quoteNumber.localeCompare(b.quoteNumber));

  const totals = {
    count: rows.length,
    poAmount: round2(rows.reduce((a, r) => a + r.poAmount, 0)),
    ewt: round2(rows.reduce((a, r) => a + r.ewt, 0)),
  };

  return { from: lo, to: hi, rows, totals, currency };
}
