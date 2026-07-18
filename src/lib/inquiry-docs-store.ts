/** Server-side read/write for an inquiry's pre-quotation documents. */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { coerceInquiryDocs } from "@/lib/inquiry-docs";
import type { SaleDoc } from "@/lib/sale";

export async function getInquiryDocs(inquiryId: string): Promise<Record<string, SaleDoc[]>> {
  const row = await prisma.inquiry.findUnique({ where: { id: inquiryId }, select: { docs: true } });
  return coerceInquiryDocs(row?.docs);
}

export async function setInquiryDocs(inquiryId: string, docs: Record<string, SaleDoc[]>): Promise<void> {
  await prisma.inquiry.update({
    where: { id: inquiryId },
    data: { docs: coerceInquiryDocs(docs) as unknown as Prisma.InputJsonValue },
  });
}
