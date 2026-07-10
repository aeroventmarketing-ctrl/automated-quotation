import { prisma } from "@/lib/db";
import { quoteSignature, type SigItem } from "@/lib/quote-signature";

export interface DuplicateMatch {
  id: string;
  quoteNumber: string;
  company: string;
  customerId: string;
  preparedBy: string;
  status: string;
  createdISO: string;
  total: number;
  currency: string;
}

/**
 * Find existing quotations whose line-item set is IDENTICAL to the given items
 * (same products, specs, and quantities), regardless of client. Pricing is
 * deterministic, so an identical item set yields an identical subtotal — used as
 * a cheap candidate filter — then confirmed with the exact line-set signature.
 */
export async function findDuplicateQuotes(opts: {
  items: SigItem[];
  subtotal: number;
  excludeQuotationId?: string;
}): Promise<DuplicateMatch[]> {
  const sig = quoteSignature(opts.items);
  if (!sig || opts.subtotal <= 0) return [];
  const candidates = await prisma.quotation.findMany({
    where: {
      subtotal: opts.subtotal,
      ...(opts.excludeQuotationId ? { id: { not: opts.excludeQuotationId } } : {}),
    },
    include: {
      items: { select: { specsSnapshot: true, qty: true, catalogueItemId: true } },
      inquiry: { include: { customer: true } },
      preparedBy: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return candidates
    .filter((c) => quoteSignature(c.items as SigItem[]) === sig)
    .map((c) => ({
      id: c.id,
      quoteNumber: c.quoteNumber,
      company: c.inquiry.customer.company,
      customerId: c.inquiry.customerId,
      preparedBy: c.preparedBy.name,
      status: c.status,
      createdISO: c.createdAt.toISOString(),
      total: Number(c.total),
      currency: c.currency,
    }));
}
