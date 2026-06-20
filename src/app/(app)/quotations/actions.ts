"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getCurrentUser, canApprove } from "@/lib/auth";
import { nextQuoteNumber, computeTotals, round2 } from "@/lib/quote";
import { config } from "@/lib/config";

const lineSchema = z.object({
  catalogueItemId: z.string().nullable().optional(),
  descriptionSnapshot: z.string().min(1),
  specsSnapshot: z.record(z.unknown()).default({}),
  qty: z.number().int().positive().default(1),
  unitPrice: z.number().min(0).optional(), // if omitted, looked up from pricelist
  selectionNote: z.string().nullable().optional(),
});

const createSchema = z.object({
  inquiryId: z.string(),
  templateId: z.string().optional(),
  lines: z.array(lineSchema).min(1),
});

/** Create a DRAFT quotation from chosen inquiry items. Pricing is deterministic. */
export async function createQuotationFromInquiry(input: z.infer<typeof createSchema>) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const data = createSchema.parse(input);

  // Resolve a default template if none provided.
  const template = data.templateId
    ? await prisma.quotationTemplate.findUnique({ where: { id: data.templateId } })
    : await prisma.quotationTemplate.findFirst({ where: { active: true }, orderBy: { name: "asc" } });
  if (!template) throw new Error("No quotation template available — seed templates first.");

  // Resolve unit prices from the pricelist where not explicitly provided.
  const resolvedLines = await Promise.all(
    data.lines.map(async (l) => {
      let unitPrice = l.unitPrice;
      if (unitPrice == null && l.catalogueItemId) {
        const price = await prisma.priceListEntry.findFirst({
          where: { catalogueItemId: l.catalogueItemId, active: true },
          orderBy: { effectiveDate: "desc" },
        });
        unitPrice = price ? Number(price.basePrice) : 0;
      }
      unitPrice = round2(unitPrice ?? 0);
      return { ...l, unitPrice, lineTotal: round2(unitPrice * l.qty) };
    }),
  );

  const totals = computeTotals(resolvedLines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })));

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  const quotation = await prisma.$transaction(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx);
    return tx.quotation.create({
      data: {
        inquiryId: data.inquiryId,
        quoteNumber,
        templateId: template.id,
        status: "DRAFT",
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        currency: config.defaultCurrency,
        validUntil,
        preparedById: user.id,
        items: {
          create: resolvedLines.map((l, i) => ({
            catalogueItemId: l.catalogueItemId ?? null,
            descriptionSnapshot: l.descriptionSnapshot,
            specsSnapshot: (l.specsSnapshot ?? {}) as object,
            qty: l.qty,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
            selectionNote: l.selectionNote ?? null,
            sortOrder: i,
          })),
        },
      },
    });
  });

  await prisma.inquiry.update({ where: { id: data.inquiryId }, data: { status: "QUOTED" } });

  revalidatePath(`/inquiries/${data.inquiryId}`);
  revalidatePath("/quotations");
  redirect(`/quotations/${quotation.id}`);
}

const editLineSchema = z.object({
  id: z.string(),
  descriptionSnapshot: z.string().min(1),
  qty: z.number().int().positive(),
  unitPrice: z.number().min(0),
  selectionNote: z.string().nullable().optional(),
});

/** Edit line items + recompute totals (only while DRAFT). */
export async function updateQuotationLines(
  quotationId: string,
  lines: z.infer<typeof editLineSchema>[],
  meta?: { templateId?: string; notes?: string; terms?: string; validUntil?: string },
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const parsed = z.array(editLineSchema).parse(lines);

  const quote = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quote) throw new Error("Quotation not found");
  if (quote.status !== "DRAFT") throw new Error("Only DRAFT quotations can be edited");

  const totals = computeTotals(parsed.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })));

  await prisma.$transaction([
    ...parsed.map((l) =>
      prisma.quotationItem.update({
        where: { id: l.id },
        data: {
          descriptionSnapshot: l.descriptionSnapshot,
          qty: l.qty,
          unitPrice: round2(l.unitPrice),
          lineTotal: round2(l.unitPrice * l.qty),
          selectionNote: l.selectionNote ?? null,
        },
      }),
    ),
    prisma.quotation.update({
      where: { id: quotationId },
      data: {
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        templateId: meta?.templateId,
        notes: meta?.notes,
        terms: meta?.terms,
        validUntil: meta?.validUntil ? new Date(meta.validUntil) : undefined,
      },
    }),
  ]);

  revalidatePath(`/quotations/${quotationId}`);
}

/** Workflow transitions: DRAFT -> PENDING_APPROVAL -> APPROVED -> SENT. */
export async function transitionQuotation(quotationId: string, to: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

  const quote = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quote) throw new Error("Quotation not found");

  const allowed: Record<string, string[]> = {
    DRAFT: ["PENDING_APPROVAL"],
    PENDING_APPROVAL: ["APPROVED", "DRAFT"],
    APPROVED: ["SENT", "PENDING_APPROVAL"],
    SENT: [],
  };
  if (!allowed[quote.status]?.includes(to)) {
    throw new Error(`Illegal transition ${quote.status} -> ${to}`);
  }

  // Approval requires Engineer/Admin (engineer-in-the-loop).
  if (to === "APPROVED" && !canApprove(user)) {
    throw new Error("Only an Engineer or Admin can approve a quotation.");
  }

  await prisma.quotation.update({
    where: { id: quotationId },
    data: {
      status: to as never,
      approvedById: to === "APPROVED" ? user.id : to === "DRAFT" ? null : quote.approvedById,
    },
  });

  if (to === "SENT") {
    await prisma.inquiry.update({ where: { id: quote.inquiryId }, data: { status: "SENT" } });
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/dashboard");
}
