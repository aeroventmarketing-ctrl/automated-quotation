import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getCurrentUser, canApprove, isAdmin } from "@/lib/auth";
import { ensureBuiltinTemplates, RETAINED_TEMPLATE_LAYOUT_KEYS, sortTemplatesByPickerOrder } from "@/lib/ensure-templates";
import { getPropellerSpLock } from "@/lib/propeller-lock";
import { getAxialSpLock } from "@/lib/axial-lock";
import { QuotationBuilder, type RevisionSnapshot } from "./quotation-builder";
import { saleFromClassification } from "@/lib/sale";
import { readPricing } from "@/lib/quote";

export const dynamic = "force-dynamic";

const num = (v: unknown): number | null =>
  typeof v === "number" && !Number.isNaN(v) ? v : null;

export default async function QuotationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Make sure the built-in "KDK" template is available in the picker.
  await ensureBuiltinTemplates();
  const [quotation, templates, user, catItems, propellerSpLock, axialSpLock] = await Promise.all([
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
    prisma.quotationTemplate.findMany({
      where: { active: true, layoutKey: { in: [...RETAINED_TEMPLATE_LAYOUT_KEYS] } },
      orderBy: { name: "asc" },
    }),
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
    getPropellerSpLock(),
    getAxialSpLock(),
  ]);

  if (!quotation) notFound();

  const catalog = Object.fromEntries(
    catItems.map((i) => [
      i.id,
      ((s) => ({
        modelCode: i.modelCode,
        description: i.description ?? "",
        basePrice: i.priceList[0] ? Number(i.priceList[0].basePrice) : 0,
        bladeDia: num(s?.bladeDia_in),
        // Air-curtain attributes (used to pick a model by height + door width).
        type: typeof s?.type === "string" ? (s.type as string) : null,
        lengthMm: num(s?.length_mm),
        heightM: num(s?.effectiveHeight_m),
        powerW: num(s?.power_w),
        airVolumeCmh: num(s?.airVolume_cmh),
      }))(i.specs as Record<string, unknown>),
    ]),
  );

  return (
    <QuotationBuilder
      canApprove={canApprove(user)}
      isAdmin={isAdmin(user)}
      isPreparer={!!user && user.id === quotation.preparedById}
      propellerSpLock={propellerSpLock}
      axialSpLock={axialSpLock}
      revisionHistory={(() => {
        const r = (quotation.classification as Record<string, unknown> | null)?.revisions;
        return Array.isArray(r) ? (r as RevisionSnapshot[]) : [];
      })()}
      catalog={catalog}
      templates={sortTemplatesByPickerOrder(templates).map((t) => {
        // Carry each pattern's own spec note + terms so switching template resets
        // those fields to the chosen pattern's defaults (never stale carry-over).
        const cfg = (t.config as Record<string, unknown>) ?? {};
        return {
          id: t.id,
          name: t.name,
          layoutKey: t.layoutKey,
          specNote: typeof cfg.specNote === "string" ? cfg.specNote : "",
          terms: typeof cfg.terms === "string" ? cfg.terms : "",
        };
      })}
      quotation={{
        id: quotation.id,
        quoteNumber: quotation.quoteNumber,
        status: quotation.status,
        sale: saleFromClassification(quotation.classification),
        revision: ((r) => (typeof r === "number" ? r : 0))((quotation.classification as Record<string, unknown> | null)?.revision),
        currency: quotation.currency,
        vatMode:
          quotation.vatMode === "EXCLUSIVE"
            ? "EXCLUSIVE"
            : quotation.vatMode === "EXCLUSIVE_PLUS"
            ? "EXCLUSIVE_PLUS"
            : "INCLUSIVE",
        discountPct: Number(quotation.discountPct ?? 0),
        pricing: readPricing(quotation.classification, Number(quotation.discountPct ?? 0)),
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
              power_w: num(s.power_w),
              blowerModel: typeof s.blowerModel === "string" ? s.blowerModel : null,
              category: typeof s.category === "string" ? s.category : "",
              brand: typeof s.brand === "string" ? s.brand : "",
              type: typeof s.type === "string" ? s.type : "",
              bladeType: typeof s.bladeType === "string" ? s.bladeType : "",
              drive: typeof s.drive === "string" ? s.drive : "",
              material: typeof s.material === "string" && s.material ? s.material : "Black Iron Sheet",
              shape: typeof s.shape === "string" ? s.shape : "",
              sizeL: typeof s.sizeL === "string" ? s.sizeL : "",
              sizeW: typeof s.sizeW === "string" ? s.sizeW : "",
              sizeUnit: typeof s.sizeUnit === "string" ? s.sizeUnit : "",
              gauge: typeof s.gauge === "string" ? s.gauge : "",
              cleatSize: typeof s.cleatSize === "string" ? s.cleatSize : "",
              canvassUnit: typeof s.canvassUnit === "string" ? s.canvassUnit : "",
              powderCoated: s.powderCoated === true,
              movement: typeof s.movement === "string" ? s.movement : "",
              acHeight: num(s.acHeight),
              acHeightUnit: typeof s.acHeightUnit === "string" ? s.acHeightUnit : "meter",
              acWidth: num(s.acWidth),
              acWidthUnit: typeof s.acWidthUnit === "string" ? s.acWidthUnit : "mm",
              mcRecommend: s.mcRecommend === true,
              exproof: s.exproof === true,
            },
            // keep any nested selection/requirement so it isn't lost on save
            rawSpecs: s,
          };
        }),
      }}
    />
  );
}
