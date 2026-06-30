"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, canApprove } from "@/lib/auth";
import { nextQuoteNumber, computeTotals, round2 } from "@/lib/quote";
import { config } from "@/lib/config";
import { RETAINED_TEMPLATE_LAYOUT_KEYS } from "@/lib/ensure-templates";

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
  projectName: z.string().optional(),
  vatMode: z.enum(["INCLUSIVE", "EXCLUSIVE", "EXCLUSIVE_PLUS"]).default("INCLUSIVE"),
  discountPct: z.number().min(0).max(100).default(0),
  headerUnits: z.record(z.string()).optional(),
  lines: z.array(lineSchema).min(1),
});

/** Create a DRAFT quotation from chosen inquiry items. Pricing is deterministic. */
export async function createQuotationFromInquiry(input: z.infer<typeof createSchema>) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const data = createSchema.parse(input);

  const template = data.templateId
    ? await prisma.quotationTemplate.findUnique({ where: { id: data.templateId } })
    : await prisma.quotationTemplate.findFirst({
        where: { active: true, layoutKey: { in: [...RETAINED_TEMPLATE_LAYOUT_KEYS] } },
        orderBy: { name: "asc" },
      });
  if (!template) throw new Error("No quotation template available — seed templates first.");

  const resolvedLines = await Promise.all(
    data.lines.map(async (l) => {
      let net = l.unitPrice;
      if (net == null && l.catalogueItemId) {
        const price = await prisma.priceListEntry.findFirst({
          where: { catalogueItemId: l.catalogueItemId, active: true },
          orderBy: { effectiveDate: "desc" },
        });
        net = price ? Number(price.basePrice) : 0;
      }
      // Catalogue prices are net (VAT-exclusive); the app stores unitPrice as
      // VAT-inclusive. Keep the net body price in specs for the motor calculator.
      const bodyNet = round2(net ?? 0);
      const unitPrice = round2(bodyNet * (1 + config.vatRate));
      const specsSnapshot = { ...(l.specsSnapshot ?? {}), bodyPrice: bodyNet };
      return { ...l, unitPrice, lineTotal: round2(unitPrice * l.qty), specsSnapshot };
    }),
  );

  const totals = computeTotals(resolvedLines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })));

  // Default validity: 1 week (matches AFBM standard terms).
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 7);

  // Pull this quote's default terms from the chosen template.
  const tplConfig = (template.config as Record<string, unknown>) ?? {};
  const terms = typeof tplConfig.terms === "string" ? tplConfig.terms : null;

  const quotation = await prisma.$transaction(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx, user.salesCode ?? "");
    return tx.quotation.create({
      data: {
        inquiryId: data.inquiryId,
        quoteNumber,
        templateId: template.id,
        status: "DRAFT",
        vatMode: data.vatMode,
        discountPct: data.discountPct,
        headerUnits: (data.headerUnits ?? { capacity: "cfm", pressure: "in-w.g.", motor: "HP" }) as object,
        projectName: data.projectName,
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        currency: config.defaultCurrency,
        validUntil,
        terms,
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
  // Existing items carry a DB id; new items use a temp id (e.g. "new-…").
  id: z.string(),
  descriptionSnapshot: z.string().default(""),
  qty: z.number().int().positive(),
  unitPrice: z.number().min(0),
  selectionNote: z.string().nullable().optional(),
  specsSnapshot: z.record(z.unknown()).optional(),
});

/** Edit line items + recompute totals (only while DRAFT). */
export async function updateQuotationLines(
  quotationId: string,
  lines: z.infer<typeof editLineSchema>[],
  meta?: {
    templateId?: string;
    notes?: string;
    terms?: string;
    validUntil?: string;
    projectName?: string;
    vatMode?: "INCLUSIVE" | "EXCLUSIVE" | "EXCLUSIVE_PLUS";
    discountPct?: number;
    headerUnits?: Record<string, string>;
    classification?: Record<string, string>;
  },
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const parsed = z.array(editLineSchema).parse(lines);

  const quote = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quote) throw new Error("Quotation not found");
  if (quote.status !== "DRAFT") throw new Error("Only DRAFT quotations can be edited");

  const totals = computeTotals(parsed.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })));

  // Sync the submitted lines against the DB: update existing, create new, delete removed.
  const existing = await prisma.quotationItem.findMany({
    where: { quotationId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const keptIds = new Set(parsed.filter((l) => existingIds.has(l.id)).map((l) => l.id));
  const toDelete = [...existingIds].filter((id) => !keptIds.has(id));

  await prisma.$transaction([
    ...parsed.map((l, i) =>
      existingIds.has(l.id)
        ? prisma.quotationItem.update({
            where: { id: l.id },
            data: {
              descriptionSnapshot: l.descriptionSnapshot,
              qty: l.qty,
              unitPrice: round2(l.unitPrice),
              lineTotal: round2(l.unitPrice * l.qty),
              selectionNote: l.selectionNote ?? null,
              sortOrder: i,
              ...(l.specsSnapshot ? { specsSnapshot: l.specsSnapshot as object } : {}),
            },
          })
        : prisma.quotationItem.create({
            data: {
              quotationId,
              descriptionSnapshot: l.descriptionSnapshot,
              qty: l.qty,
              unitPrice: round2(l.unitPrice),
              lineTotal: round2(l.unitPrice * l.qty),
              selectionNote: l.selectionNote ?? null,
              sortOrder: i,
              specsSnapshot: (l.specsSnapshot ?? {}) as object,
            },
          }),
    ),
    ...(toDelete.length ? [prisma.quotationItem.deleteMany({ where: { id: { in: toDelete } } })] : []),
    prisma.quotation.update({
      where: { id: quotationId },
      data: {
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        templateId: meta?.templateId,
        notes: meta?.notes,
        terms: meta?.terms,
        projectName: meta?.projectName,
        vatMode: meta?.vatMode,
        discountPct: meta?.discountPct,
        headerUnits: meta?.headerUnits as object | undefined,
        classification: meta?.classification as object | undefined,
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

/**
 * Open a new revision of a quotation: bump its revision counter (shown as
 * "rev. N" after the quote number) and reopen it for editing (back to DRAFT,
 * clearing the prior approval so it is re-approved). The counter rides in the
 * classification JSON, so no schema change is needed.
 */
export async function reviseQuotation(quotationId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: {
      id: true,
      classification: true,
      preparedById: true,
      subtotal: true,
      vat: true,
      total: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: { descriptionSnapshot: true, specsSnapshot: true, qty: true, unitPrice: true, lineTotal: true },
      },
    },
  });
  if (!quote) throw new Error("Quotation not found");
  // Only the salesperson who prepared the quote may revise it.
  if (quote.preparedById !== user.id) throw new Error("Only the preparer can revise this quotation.");

  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const currentRev = typeof cls.revision === "number" ? cls.revision : 0;
  // Snapshot the version being superseded so past revisions stay for reference.
  const snapshot = {
    rev: currentRev,
    savedAt: new Date().toISOString(),
    savedById: user.id,
    subtotal: Number(quote.subtotal),
    vat: Number(quote.vat),
    total: Number(quote.total),
    lines: quote.items.map((it) => ({
      itemLabel: ((s) => (typeof s?.itemLabel === "string" ? s.itemLabel : ""))(
        it.specsSnapshot as Record<string, unknown>,
      ),
      description: it.descriptionSnapshot,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
    })),
  };
  const prev = Array.isArray(cls.revisions) ? cls.revisions : [];
  const revisions = [...prev, snapshot];
  const revision = currentRev + 1;

  await prisma.quotation.update({
    where: { id: quotationId },
    data: {
      status: "DRAFT",
      approvedById: null,
      classification: { ...cls, revision, revisions } as Prisma.InputJsonObject,
    },
  });
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/dashboard");
}

/**
 * Convert a quotation into a sale (the client purchased) or undo it. The sale is
 * stamped on the quote (date + who recorded it) and the inquiry is marked WON;
 * the sale is credited to the quote's preparer (salesperson in charge) on the
 * dashboard. Undoing clears the stamp and returns the inquiry to SENT.
 */
export async function markQuotationSold(quotationId: string, sold: boolean) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, inquiryId: true, classification: true },
  });
  if (!quote) throw new Error("Quotation not found");
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const classification = {
    ...cls,
    sale: sold ? { soldAt: new Date().toISOString(), recordedById: user.id } : null,
  };
  await prisma.$transaction([
    prisma.quotation.update({
      where: { id: quotationId },
      data: { classification: classification as Prisma.InputJsonObject },
    }),
    prisma.inquiry.update({
      where: { id: quote.inquiryId },
      data: { status: sold ? "WON" : "SENT" },
    }),
  ]);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/dashboard");
}
