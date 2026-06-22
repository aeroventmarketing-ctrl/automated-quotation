import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, canApprove } from "@/lib/auth";
import { QuotationBuilder } from "./quotation-builder";

export const dynamic = "force-dynamic";

const num = (v: unknown): number | null =>
  typeof v === "number" && !Number.isNaN(v) ? v : null;

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
        vatMode: quotation.vatMode === "EXCLUSIVE" ? "EXCLUSIVE" : "INCLUSIVE",
        discountPct: Number(quotation.discountPct ?? 0),
        headerUnits: {
          capacity: (quotation.headerUnits as Record<string, string>)?.capacity ?? "cfm",
          pressure: (quotation.headerUnits as Record<string, string>)?.pressure ?? "in-w.g.",
          motor: (quotation.headerUnits as Record<string, string>)?.motor ?? "Hp",
        },
        classification: {
          category: (quotation.classification as Record<string, string>)?.category ?? "",
          type: (quotation.classification as Record<string, string>)?.type ?? "",
          bladeType: (quotation.classification as Record<string, string>)?.bladeType ?? "",
          drive: (quotation.classification as Record<string, string>)?.drive ?? "",
        },
        projectName: quotation.projectName ?? quotation.inquiry.projectName ?? "",
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
        items: quotation.items.map((it) => {
          const s = (it.specsSnapshot as Record<string, unknown>) ?? {};
          return {
            id: it.id,
            descriptionSnapshot: it.descriptionSnapshot,
            qty: it.qty,
            unitPrice: Number(it.unitPrice),
            lineTotal: Number(it.lineTotal),
            selectionNote: it.selectionNote,
            specs: {
              itemLabel: typeof s.itemLabel === "string" ? s.itemLabel : "",
              capacity_cfm: num(s.capacity_cfm),
              staticPressure_pa: num(s.staticPressure_pa),
              inches: num(s.inches),
              motorHp: num(s.motorHp),
              motorPh: num(s.motorPh),
              motorVolts: num(s.motorVolts),
              motorPole: num(s.motorPole),
              bodyPrice: num(s.bodyPrice),
              blowerModel: typeof s.blowerModel === "string" ? s.blowerModel : null,
            },
            // keep any nested selection/requirement so it isn't lost on save
            rawSpecs: s,
          };
        }),
      }}
    />
  );
}
