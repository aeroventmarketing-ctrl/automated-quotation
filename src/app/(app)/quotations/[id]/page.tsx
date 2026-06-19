import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, canApprove } from "@/lib/auth";
import { QuotationBuilder } from "./quotation-builder";

export const dynamic = "force-dynamic";

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [quotation, templates, user] = await Promise.all([
    prisma.quotation.findUnique({
      where: { id },
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        template: true,
        inquiry: { include: { customer: true } },
        preparedBy: true,
        approvedBy: true,
      },
    }),
    prisma.quotationTemplate.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    getCurrentUser(),
  ]);

  if (!quotation) notFound();

  return (
    <QuotationBuilder
      canApprove={canApprove(user)}
      templates={templates.map((t) => ({ id: t.id, name: t.name }))}
      quotation={{
        id: quotation.id,
        quoteNumber: quotation.quoteNumber,
        status: quotation.status,
        currency: quotation.currency,
        subtotal: Number(quotation.subtotal),
        vat: Number(quotation.vat),
        total: Number(quotation.total),
        notes: quotation.notes,
        terms: quotation.terms,
        validUntil: quotation.validUntil ? quotation.validUntil.toISOString().slice(0, 10) : "",
        templateId: quotation.templateId,
        templateName: quotation.template.name,
        customer: quotation.inquiry.customer.company,
        preparedBy: quotation.preparedBy.name,
        approvedBy: quotation.approvedBy?.name ?? null,
        items: quotation.items.map((it) => ({
          id: it.id,
          descriptionSnapshot: it.descriptionSnapshot,
          qty: it.qty,
          unitPrice: Number(it.unitPrice),
          lineTotal: Number(it.lineTotal),
          selectionNote: it.selectionNote,
        })),
      }}
    />
  );
}
