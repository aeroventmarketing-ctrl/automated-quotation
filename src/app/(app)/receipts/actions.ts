"use server";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { getAccountData } from "@/lib/account";
import { canGenerateReceipts } from "@/lib/receipts-access";
import { payableTotal } from "@/lib/quote";
import { saleFromClassification, ewtWithheld } from "@/lib/sale";
import { manilaYMD } from "@/lib/department-pnl";
import { linesFromQuotation, receiptDate, type ReceiptInput } from "@/lib/bir-receipts";

/**
 * Fill the receipt form from an order. Everything stays editable — this saves
 * typing, it doesn't decide anything:
 *  - the client's name, TIN, address, and the Trade Name as Business Style, from
 *    the client's BIR 2303 where one is on file (the profile otherwise);
 *  - the quotation's lines, priced so they add up to what the client pays;
 *  - VAT 12% on a VAT order, 0% with the total as Zero Rated Sales on a
 *    zero-rated one; EWT 1% when the client withheld EWT on this order.
 */
export async function prefillReceipt(quotationId: string): Promise<ReceiptInput> {
  const user = await getCurrentUser();
  if (!user || !canGenerateReceipts(user, await getWorkflowRoles())) throw new Error("Not allowed.");
  const q = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: {
      total: true, discountPct: true, vatMode: true, classification: true,
      items: { orderBy: { sortOrder: "asc" }, select: { qty: true, lineTotal: true, descriptionSnapshot: true, catalogueItem: { select: { uom: true } } } },
      inquiry: { select: { customer: { select: { id: true, company: true, address: true } } } },
    },
  });
  if (!q) throw new Error("Order not found.");
  const customer = q.inquiry?.customer;
  const account = customer ? await getAccountData(customer.id) : null;
  const bir = account?.bir2303;
  const payable = payableTotal(q);
  const sale = saleFromClassification(q.classification);
  const zeroRated = q.vatMode === "ZERO_RATED";
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
    zeroRatedSales: zeroRated ? payable : 0,
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
