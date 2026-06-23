import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, canApprove } from "@/lib/auth";
import { QuotationBuilder } from "./quotation-builder";

export const dynamic = "force-dynamic";

const num = (v: unknown): number | null =>
  typeof v === "number" && !Number.isNaN(v) ? v : null;

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [quotation, templates, user, catItems] = await Promise.all([
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
    prisma.catalogueItem.findMany({
      where: { active: true },
      select: {
        id: true,
        modelCode: true,
        description: true,
        specs: true,
        priceList: { where: { variantKey: "default" }, take: 1, select: { basePrice: true } },
      },
    }),
  ]);

  if (!quotation) notFound();

  const catalog = Object.fromEntries(
    catItems.map((i) => [
      i.id,
      {
        modelCode: i.modelCode,
        description: i.description ?? "",
        basePrice: i.priceList[0] ? Number(i.priceList[0].basePrice) : 0,
        bladeDia: num((i.specs as Record<string, unknown>)?.bladeDia_in),
      },
    ]),
  );

  return (
    <QuotationBuilder
      canApprove={canApprove(user)}
      catalog={catalog}
      templates={templates.map((t) => ({ id: t.id, name: t.name }))}
      quotation={{
        id: quotation.id,
        quoteNumber: quotation.quoteNumber,
        status: quotation.status,
        currency: quotation.currency,
        vatMode:
          quotation.vatMode === "EXCLUSIVE"
            ? "EXCLUSIVE"
            : quotation.vatMode === "EXCLUSIVE_PLUS"
            ? "EXCLUSIVE_PLUS"
            : "INCLUSIVE",
        discountPct: Number(quotation.discountPct ?? 0),
        headerUnits: {
          capacity: (quotation.headerUnits as Record<string, string>)?.capacity || "cfm",
          pressure: (quotation.headerUnits as Record<string, string>)?.pressure || "in-w.g.",
          motor: ((m) => (m === "Hp" ? "HP" : m))((quotation.headerUnits as Record<string, string>)?.motor || "HP"),
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
              category: typeof s.category === "string" ? s.category : "",
              type: typeof s.type === "string" ? s.type : "",
              bladeType: typeof s.bladeType === "string" ? s.bladeType : "",
              drive: typeof s.drive === "string" ? s.drive : "",
              material: typeof s.material === "string" && s.material ? s.material : "Black Iron Sheet",
              shape: typeof s.shape === "string" ? s.shape : "",
              sizeL: typeof s.sizeL === "string" ? s.sizeL : "",
              sizeW: typeof s.sizeW === "string" ? s.sizeW : "",
            },
            // keep any nested selection/requirement so it isn't lost on save
            rawSpecs: s,
          };
        }),
      }}
    />
  );
}
