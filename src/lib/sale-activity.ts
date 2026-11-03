/**
 * The activity entry for un-booking a won deal.
 *
 * Two routes remove a sale from a quotation — Accounting's "Clear sale" on the
 * quotation, and an admin's "Remove order" on the client page — and both leave
 * the deal out of the WON sales report and the dashboard's "Sales this month"
 * from that moment on, because both surfaces count a quotation only while its
 * sale is confirmed.
 *
 * Neither route recorded anything, so a month's sales could drop with nothing
 * anywhere to say why: the record that held the figures is exactly the record
 * being deleted. This builds the entry both of them write, capturing those
 * figures before they go.
 */
import type { Prisma } from "@prisma/client";
import type { LogActivityInput } from "@/lib/activity-log";
import { payableTotal, round2 } from "@/lib/quote";
import { collectedTotal, isSaleConfirmed, type SaleRecord } from "@/lib/sale";

/** The quotation fields the entry needs — a subset any caller can select. */
export interface SaleRemovalQuote {
  id: string;
  quoteNumber: string;
  total: Prisma.Decimal | number;
  discountPct: Prisma.Decimal | number;
  vatMode: string;
  currency?: string | null;
  classification: unknown;
  inquiry?: { customer?: { company: string | null } | null } | null;
}

export function saleRemovalActivity(
  quote: SaleRemovalQuote,
  cleared: SaleRecord | null,
  action: "sale.cleared" | "order.removed",
  label: string,
): LogActivityInput {
  const company = quote.inquiry?.customer?.company ?? "customer";
  // The same deal value the sales report and the dashboard were counting.
  const value = round2(payableTotal(quote));
  const amount = value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return {
    action,
    category: "quotation",
    summary: `${label} — ${company} (${quote.quoteNumber}), ${amount} off the books`,
    entity: "quotation",
    entityId: quote.id,
    href: `/quotations/${quote.id}`,
    meta: {
      dealValue: value,
      currency: quote.currency ?? null,
      // An unconfirmed sale was never in the sales figures, so its removal
      // changes no total — worth telling apart when reading the feed back.
      wasConfirmed: isSaleConfirmed(cleared),
      arrangement: cleared?.arrangement ?? null,
      hadPo: !!cleared?.po,
      payments: cleared?.payments?.length ?? 0,
      collected: round2(collectedTotal(cleared)),
    },
  };
}
