/**
 * The order's figures for Receipt Generation — server-only (reads the order and
 * the client's account). Everything it fills stays editable on the form; this
 * saves typing, it doesn't decide anything:
 *  - the client's name, TIN, address, and the Trade Name as Business Style, from
 *    the client's BIR 2303 where one is on file (the profile otherwise);
 *  - the quotation's lines, priced so they add up to what the client pays;
 *  - VAT 12% on a VAT order, 0% with the total as Zero Rated Sales on a
 *    zero-rated one; EWT 1% when the client withheld EWT on this order.
 */
import { prisma } from "@/lib/db";
import { getAccountData } from "@/lib/account";
import { payableTotal } from "@/lib/quote";
import { saleFromClassification, ewtWithheld } from "@/lib/sale";
import { manilaYMD } from "@/lib/department-pnl";
import { linesFromQuotation, receiptDate, type ReceiptInput } from "@/lib/bir-receipts";

export async function receiptPrefillFor(quotationId: string): Promise<ReceiptInput | null> {
  const q = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: {
      total: true, discountPct: true, vatMode: true, classification: true,
      items: { orderBy: { sortOrder: "asc" }, select: { qty: true, lineTotal: true, descriptionSnapshot: true, catalogueItem: { select: { uom: true } } } },
      inquiry: { select: { customer: { select: { id: true, company: true, address: true } } } },
    },
  });
  if (!q) return null;
  const customer = q.inquiry?.customer;
  const account = customer ? await getAccountData(customer.id) : null;
  const bir = account?.bir2303;
  const payable = payableTotal(q);
  const sale = saleFromClassification(q.classification);
  const chargesVat = q.vatMode === "INCLUSIVE" || q.vatMode === "EXCLUSIVE_PLUS";
  return {
    date: receiptDate(manilaYMD(new Date().toISOString())),
    companyName: customer?.company ?? "",
    tin: account?.tin ?? "",
    address: bir?.registeredAddress ?? customer?.address ?? "",
    businessStyle: bir?.tradeName ?? "",
    paymentOf: "",
    amountWords1: "",
    amountWords2: "",
    vatRatePct: chargesVat ? 12 : 0,
    ewtRatePct: ewtWithheld(sale) > 0 ? 1 : 0,
    vatExemptSales: 0,
    zeroRatedSales: q.vatMode === "ZERO_RATED" ? payable : 0,
    lines: linesFromQuotation(
      q.items.map((i) => ({
        qty: i.qty,
        lineTotal: Number(i.lineTotal),
        description: i.descriptionSnapshot,
        unit: i.catalogueItem?.uom && i.catalogueItem.uom !== "unit" ? i.catalogueItem.uom : null,
      })),
      payable,
    ),
  };
}
