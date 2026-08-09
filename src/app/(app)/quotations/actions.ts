"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, canApprove, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole } from "@/lib/workflow-roles";
import { readOrderWorkflow, stageIndex } from "@/lib/order-workflow";
import { nextQuoteNumber, computeTotals, round2 } from "@/lib/quote";
import { config } from "@/lib/config";
import { RETAINED_TEMPLATE_LAYOUT_KEYS, sortTemplatesByPickerOrder } from "@/lib/ensure-templates";
import { isSaleConfirmed, saleFromClassification, type SaleRecord, type SalePayment } from "@/lib/sale";
import { applyPaymentSlipRules } from "@/lib/payment-slip";
import { getInquiryDocs } from "@/lib/inquiry-docs-store";
import { inquiryDocsMissing } from "@/lib/inquiry-docs";
import { findDuplicateQuotes, type DuplicateMatch } from "@/lib/quote-duplicates";
import { logActivity } from "@/lib/activity-log";
import { isCurrentAccountOwner } from "@/lib/account";

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
  vatMode: z.enum(["INCLUSIVE", "EXCLUSIVE", "EXCLUSIVE_PLUS", "ZERO_RATED"]).default("INCLUSIVE"),
  discountPct: z.number().min(0).max(100).default(0),
  headerUnits: z.record(z.string()).optional(),
  // Lines are optional — a draft can be created empty and built in the editor.
  lines: z.array(lineSchema).default([]),
});

/** Create a DRAFT quotation from chosen inquiry items. Pricing is deterministic. */
export async function createQuotationFromInquiry(input: z.infer<typeof createSchema>) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const data = createSchema.parse(input);

  // Gate: the Inquiry Form and RFQ / BOQ must be attached before a quotation.
  const inquiryDocs = await getInquiryDocs(data.inquiryId);
  const missingDocs = inquiryDocsMissing(inquiryDocs);
  if (missingDocs.length) throw new Error(`Attach ${missingDocs.join(" and ")} to the inquiry before creating a quotation.`);

  const template = data.templateId
    ? await prisma.quotationTemplate.findUnique({ where: { id: data.templateId } })
    : // Default to the first template in picker order (Fans and Blowers).
      sortTemplatesByPickerOrder(
        await prisma.quotationTemplate.findMany({
          where: { active: true, layoutKey: { in: [...RETAINED_TEMPLATE_LAYOUT_KEYS] } },
        }),
      )[0] ?? null;
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

  // Seed the sale documents with the inquiry's Inquiry Form + RFQ/BOQ so they
  // reflect in the quotation's Sale & payment panel.
  const seededSale = {
    arrangement: "downpayment_full",
    payments: [],
    docs: { inquiry_form: inquiryDocs.inquiry_form ?? [], rfq_boq: inquiryDocs.rfq_boq ?? [] },
  };

  const quotation = await prisma.$transaction(async (tx) => {
    const quoteNumber = await nextQuoteNumber(tx, user.salesCode ?? "");
    return tx.quotation.create({
      data: {
        inquiryId: data.inquiryId,
        quoteNumber,
        templateId: template.id,
        classification: { sale: seededSale } as unknown as Prisma.InputJsonObject,
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
  // Explicit gross line total (VAT applied at the line level, e.g. Duct Angle
  // corner). When omitted the line total is round2(unitPrice × qty).
  lineTotal: z.number().min(0).optional(),
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
    vatMode?: "INCLUSIVE" | "EXCLUSIVE" | "EXCLUSIVE_PLUS" | "ZERO_RATED";
    discountPct?: number;
    pricing?: {
      markupMode: "percent" | "amount";
      markupValue: number;
      discountMode: "percent" | "amount";
      discountValue: number;
    };
    headerUnits?: Record<string, string>;
    classification?: Record<string, string>;
  },
  opts?: { revalidate?: boolean },
) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const parsed = z.array(editLineSchema).parse(lines);

  const quote = await prisma.quotation.findUnique({ where: { id: quotationId } });
  if (!quote) throw new Error("Quotation not found");
  // DRAFT is editable by the preparer; Engineers / admins may edit any status.
  if (quote.status !== "DRAFT" && !canApprove(user)) throw new Error("Only DRAFT quotations can be edited");

  // Merge the pricing adjustments into the existing classification blob so we
  // don't clobber sale/revision data that also lives there.
  const mergedClassification =
    meta?.pricing || meta?.classification
      ? {
          ...((quote.classification as Record<string, unknown> | null) ?? {}),
          ...(meta?.classification ?? {}),
          ...(meta?.pricing ? { pricing: meta.pricing } : {}),
        }
      : undefined;

  const totals = computeTotals(
    parsed.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, lineTotal: l.lineTotal })),
  );

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
              lineTotal: round2(l.lineTotal ?? l.unitPrice * l.qty),
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
              lineTotal: round2(l.lineTotal ?? l.unitPrice * l.qty),
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
        classification: mergedClassification as object | undefined,
        validUntil: meta?.validUntil ? new Date(meta.validUntil) : undefined,
      },
    }),
  ]);

  // Auto-save persists silently: skipping revalidation avoids refreshing the
  // route the user is actively editing (which would re-run mount effects and,
  // e.g., reset the header units mid-edit). Other views catch up on the next
  // manual save or navigation.
  if (opts?.revalidate !== false) revalidatePath(`/quotations/${quotationId}`);
}

/** Delete a quotation (admin only). Its line items cascade; the inquiry stays. */
export async function deleteQuotation(quotationId: string) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Admin access required");
  await prisma.quotation.delete({ where: { id: quotationId } });
  revalidatePath("/quotations");
  revalidatePath("/dashboard");
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
    // Stamp the send date into the classification JSON (no schema change) — it
    // starts the follow-up clock for the Sales/CRM follow-up engine. Preserve an
    // existing stamp so the original send date is never overwritten.
    const cls = (quote.classification as Record<string, unknown>) ?? {};
    await prisma.$transaction([
      prisma.quotation.update({
        where: { id: quotationId },
        data: {
          classification: {
            ...cls,
            sentAt: typeof cls.sentAt === "string" ? cls.sentAt : new Date().toISOString(),
          } as Prisma.InputJsonObject,
        },
      }),
      prisma.inquiry.update({ where: { id: quote.inquiryId }, data: { status: "SENT" } }),
    ]);
  }

  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/dashboard");
  revalidatePath("/follow-ups");
}

/**
 * Open a new revision of a quotation: bump its revision counter (shown as
 * "rev. N" after the quote number) and reopen it for editing (back to DRAFT,
 * clearing the prior approval so it is re-approved). The counter rides in the
 * classification JSON, so no schema change is needed.
 */
// Fields a revision snapshot needs from the live quotation + its items.
const REVISION_SELECT = {
  id: true,
  classification: true,
  preparedById: true,
  subtotal: true,
  vat: true,
  total: true,
  vatMode: true,
  discountPct: true,
  inquiry: { select: { customerId: true } },
  items: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      descriptionSnapshot: true,
      specsSnapshot: true,
      qty: true,
      unitPrice: true,
      lineTotal: true,
      selectionNote: true,
      sortOrder: true,
    },
  },
} as const;

type RevisionQuote = {
  subtotal: unknown; vat: unknown; total: unknown; vatMode: string; discountPct: unknown;
  items: { descriptionSnapshot: string; specsSnapshot: unknown; qty: number; unitPrice: unknown; lineTotal: unknown; selectionNote: string | null; sortOrder: number }[];
};

/**
 * Build a revision snapshot from the live quotation. Stores the display summary
 * (`lines`) AND the full per-line content (`fullLines`, incl. specsSnapshot) plus
 * the pricing context, so a revision can later be RESTORED faithfully — not just
 * shown. (Snapshots taken before `fullLines` existed restore from the summary only.)
 */
function buildRevSnapshot(rev: number, userId: string, q: RevisionQuote) {
  const labelOf = (s: unknown) => (typeof (s as Record<string, unknown>)?.itemLabel === "string" ? (s as Record<string, string>).itemLabel : "");
  return {
    rev,
    savedAt: new Date().toISOString(),
    savedById: userId,
    subtotal: Number(q.subtotal),
    vat: Number(q.vat),
    total: Number(q.total),
    vatMode: q.vatMode,
    discountPct: Number(q.discountPct),
    lines: q.items.map((it) => ({
      itemLabel: labelOf(it.specsSnapshot),
      description: it.descriptionSnapshot,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
    })),
    fullLines: q.items.map((it) => ({
      descriptionSnapshot: it.descriptionSnapshot,
      specsSnapshot: (it.specsSnapshot ?? {}) as Prisma.InputJsonValue,
      qty: it.qty,
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
      selectionNote: it.selectionNote ?? null,
      sortOrder: it.sortOrder,
    })),
  };
}

export async function reviseQuotation(quotationId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: REVISION_SELECT,
  });
  if (!quote) throw new Error("Quotation not found");
  const admin = isAdmin(user);
  const isEngineer = user.role === "ENGINEER";
  // The preparer OR the current sales in-charge (after an account transfer).
  const isPreparer = quote.preparedById === user.id || (await isCurrentAccountOwner(quote.inquiry.customerId, user.id));
  const saleSaved = !!saleFromClassification(quote.classification);
  // Once the order is in production (or later) the quotation is locked to Sales —
  // only an Engineer or an admin can still revise it.
  if (!(admin || isEngineer) && stageIndex(readOrderWorkflow(quote.classification).stage) >= stageIndex("producing")) {
    throw new Error("This order is already in production — only an Engineer or an admin can revise the quotation.");
  }
  // Admins and Engineers may revise (authorize a revision) anytime. The preparer
  // (Sales) may revise only until a sale is saved; after a sale is recorded, only
  // an Engineer or an admin can authorize the revision.
  if (!(admin || isEngineer || (isPreparer && !saleSaved))) {
    throw new Error(
      saleSaved
        ? "A sale is already recorded — only an Engineer or an admin can authorize a revision now."
        : "Only the preparer, an Engineer or an admin can revise this quotation.",
    );
  }

  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const currentRev = typeof cls.revision === "number" ? cls.revision : 0;
  // Snapshot the version being superseded so past revisions stay for reference.
  const snapshot = buildRevSnapshot(currentRev, user.id, quote);
  const prev = Array.isArray(cls.revisions) ? (cls.revisions as { rev?: unknown }[]) : [];
  const revisions = [...prev, snapshot];
  // New revision number = one past the highest ever used, so re-pointing to an
  // earlier revision (which lowers `revision`) never collides with an existing one.
  const maxRev = Math.max(currentRev, ...prev.map((r) => (typeof r.rev === "number" ? r.rev : 0)));
  const revision = maxRev + 1;

  await prisma.quotation.update({
    where: { id: quotationId },
    data: {
      status: "DRAFT",
      approvedById: null,
      // Stamp the revision date (when "Revise" was clicked) so the quote date on
      // the Excel / PDF follows the current revision, not the original creation.
      classification: { ...cls, revision, revisions, revisedAt: new Date().toISOString() } as Prisma.InputJsonObject,
    },
  });
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/dashboard");
}

// ── Revision restore (re-point the live quote to an earlier revision) ──────────
// A client sometimes settles on an earlier revision. Sales requests the restore;
// an Engineer / admin approves it. On approval the live quote is re-pointed to the
// chosen revision — the same quotation number, still APPROVED — while every other
// revision is kept (the superseded current version is snapshotted first).

type RestoreLine = {
  descriptionSnapshot: string; specsSnapshot?: unknown; qty: number; unitPrice: number;
  lineTotal: number; selectionNote?: string | null; sortOrder?: number;
};
type RevSnap = {
  rev: number; total?: number; subtotal?: number; vat?: number; vatMode?: string; discountPct?: number;
  fullLines?: RestoreLine[]; lines?: { itemLabel?: string; description: string; qty: number; unitPrice: number; lineTotal: number }[];
};

/** Read the revisions array from a classification blob. */
function readRevisions(cls: Record<string, unknown>): RevSnap[] {
  return Array.isArray(cls.revisions) ? (cls.revisions as RevSnap[]) : [];
}

/** Sales (preparer / current owner) or an Engineer / admin requests a restore. */
export async function requestRevisionRestore(quotationId: string, targetRev: number) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { classification: true, preparedById: true, inquiry: { select: { customerId: true } } },
  });
  if (!quote) throw new Error("Quotation not found");
  const isPreparer = quote.preparedById === user.id || (await isCurrentAccountOwner(quote.inquiry.customerId, user.id));
  if (!(isAdmin(user) || user.role === "ENGINEER" || isPreparer)) {
    throw new Error("Only the preparer, an Engineer or an admin can request a revision restore.");
  }
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const currentRev = typeof cls.revision === "number" ? cls.revision : 0;
  if (targetRev === currentRev) throw new Error("That revision is already the current one.");
  if (!readRevisions(cls).some((r) => r.rev === targetRev)) throw new Error("That revision isn't in the history.");
  const revisionRestore = {
    targetRev,
    requestedById: user.id,
    requestedByName: user.name,
    requestedAt: new Date().toISOString(),
  };
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: { ...cls, revisionRestore } as Prisma.InputJsonObject },
  });
  await logActivity(user, {
    action: "quotation.revision.restore.request",
    category: "quotation",
    summary: `Requested restore to rev. ${targetRev}`,
    entity: "quotation",
    entityId: quotationId,
    href: `/quotations/${quotationId}`,
  });
  revalidatePath(`/quotations/${quotationId}`);
}

/** Cancel a pending restore request (the requester, an Engineer or an admin). */
export async function cancelRevisionRestore(quotationId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { classification: true, preparedById: true, inquiry: { select: { customerId: true } } },
  });
  if (!quote) throw new Error("Quotation not found");
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const req = cls.revisionRestore as { requestedById?: string } | undefined;
  const isRequester = !!req?.requestedById && req.requestedById === user.id;
  const isPreparer = quote.preparedById === user.id || (await isCurrentAccountOwner(quote.inquiry.customerId, user.id));
  if (!(isAdmin(user) || user.role === "ENGINEER" || isRequester || isPreparer)) {
    throw new Error("You can't cancel this restore request.");
  }
  const next = { ...cls };
  delete next.revisionRestore;
  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: next as Prisma.InputJsonObject },
  });
  revalidatePath(`/quotations/${quotationId}`);
}

/**
 * Engineer / admin approves the pending restore: re-point the live quote to the
 * requested revision. The superseded current version is snapshotted first (so no
 * revision is lost); the target is rebuilt as the live line items (full specs when
 * the snapshot has them, summary otherwise); the quote keeps its APPROVED status;
 * and the approval (who / position / when) is recorded.
 */
export async function approveRevisionRestore(quotationId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || user.role === "ENGINEER")) {
    throw new Error("Only an Engineer or an admin can approve a revision restore.");
  }
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: REVISION_SELECT,
  });
  if (!quote) throw new Error("Quotation not found");
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const req = cls.revisionRestore as { targetRev?: number; requestedByName?: string; requestedAt?: string } | undefined;
  if (typeof req?.targetRev !== "number") throw new Error("There's no pending restore request.");
  const targetRev = req.targetRev;
  const currentRev = typeof cls.revision === "number" ? cls.revision : 0;
  const revisions = readRevisions(cls);
  const target = revisions.find((r) => r.rev === targetRev);
  if (!target) throw new Error("That revision is no longer in the history.");

  // Snapshot the current (superseded) version so it isn't lost, then drop the
  // target from history (it becomes the live version). Everything else is kept.
  const currentSnap = buildRevSnapshot(currentRev, user.id, quote);
  const nextRevisions = [...revisions.filter((r) => r.rev !== targetRev), currentSnap];

  // Rebuild the target's line items. Prefer the full snapshot; fall back to the
  // display summary (older snapshots) — descriptions/qty/price only, minimal specs.
  const src: RestoreLine[] = target.fullLines?.length
    ? target.fullLines
    : (target.lines ?? []).map((l, i) => ({
        descriptionSnapshot: l.description,
        specsSnapshot: l.itemLabel ? { itemLabel: l.itemLabel } : {},
        qty: l.qty,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        selectionNote: null,
        sortOrder: i,
      }));
  if (src.length === 0) throw new Error("That revision has no line items to restore.");

  const position = isAdmin(user) ? "Admin" : "Engineer";
  const restoreLog = Array.isArray(cls.revisionRestores) ? (cls.revisionRestores as unknown[]) : [];
  const nextClassification = { ...cls } as Record<string, unknown>;
  delete nextClassification.revisionRestore;
  nextClassification.revision = targetRev;
  nextClassification.revisions = nextRevisions;
  nextClassification.revisionRestores = [
    ...restoreLog,
    {
      fromRev: currentRev,
      toRev: targetRev,
      requestedByName: req.requestedByName ?? null,
      requestedAt: req.requestedAt ?? null,
      approvedById: user.id,
      approvedByName: user.name,
      approvedPosition: position,
      approvedAt: new Date().toISOString(),
    },
  ];

  const subtotal = round2(Number(target.subtotal ?? src.reduce((a, l) => a + l.lineTotal, 0)));
  const vat = round2(Number(target.vat ?? 0));
  const total = round2(Number(target.total ?? subtotal + vat));

  await prisma.$transaction([
    prisma.quotationItem.deleteMany({ where: { quotationId } }),
    ...src.map((l, i) =>
      prisma.quotationItem.create({
        data: {
          quotationId,
          descriptionSnapshot: l.descriptionSnapshot,
          qty: l.qty,
          unitPrice: round2(l.unitPrice),
          lineTotal: round2(l.lineTotal ?? l.unitPrice * l.qty),
          selectionNote: l.selectionNote ?? null,
          sortOrder: l.sortOrder ?? i,
          specsSnapshot: (l.specsSnapshot ?? {}) as Prisma.InputJsonValue,
        },
      }),
    ),
    prisma.quotation.update({
      where: { id: quotationId },
      data: {
        subtotal,
        vat,
        total,
        ...(target.vatMode ? { vatMode: target.vatMode as "INCLUSIVE" | "EXCLUSIVE" | "EXCLUSIVE_PLUS" | "ZERO_RATED" } : {}),
        ...(typeof target.discountPct === "number" ? { discountPct: target.discountPct } : {}),
        classification: nextClassification as Prisma.InputJsonObject,
        // Status stays as-is (the restored revision was approved before).
      },
    }),
  ]);
  await logActivity(user, {
    action: "quotation.revision.restore.approve",
    category: "quotation",
    summary: `Restored rev. ${targetRev} (from rev. ${currentRev})`,
    entity: "quotation",
    entityId: quotationId,
    href: `/quotations/${quotationId}`,
  });
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/dashboard");
}

/** Search customers by company name for the "Duplicate to another client" picker. */
export async function searchCustomers(query: string): Promise<{ id: string; company: string }[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const q = query.trim();
  if (!q) return [];
  const customers = await prisma.customer.findMany({
    where: { company: { contains: q, mode: Prisma.QueryMode.insensitive } },
    select: { id: true, company: true },
    orderBy: { company: "asc" },
    take: 10,
  });
  return customers;
}

/**
 * Duplicate a quotation to another client: create a fresh inquiry + DRAFT
 * quotation for the target customer, copying the line items (specs, qty, price)
 * as-is. Sale state and revision history are not carried over. Redirects to the
 * new draft, which can then be edited independently.
 */
export async function duplicateQuotationToCustomer(quotationId: string, customerId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const src = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!src) throw new Error("Quotation not found");
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) throw new Error("Customer not found");

  const totals = computeTotals(
    src.items.map((it) => ({ qty: it.qty, unitPrice: Number(it.unitPrice), lineTotal: Number(it.lineTotal) })),
  );
  // Carry the product classification but not the sale state or revision history.
  const classification = { ...((src.classification as Record<string, unknown>) ?? {}) };
  delete classification.sale;
  delete classification.revision;
  delete classification.revisions;

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 7);

  const created = await prisma.$transaction(async (tx) => {
    const inquiry = await tx.inquiry.create({
      data: {
        customerId,
        source: "OTHER",
        status: "QUOTED",
        createdById: user.id,
        projectName: src.projectName ?? null,
        notes: `Duplicated from ${src.quoteNumber}`,
      },
    });
    const quoteNumber = await nextQuoteNumber(tx, user.salesCode ?? "");
    return tx.quotation.create({
      data: {
        inquiryId: inquiry.id,
        quoteNumber,
        templateId: src.templateId,
        status: "DRAFT",
        vatMode: src.vatMode,
        discountPct: src.discountPct,
        headerUnits: (src.headerUnits ?? {}) as object,
        classification: classification as Prisma.InputJsonObject,
        projectName: src.projectName,
        subtotal: totals.subtotal,
        vat: totals.vat,
        total: totals.total,
        currency: src.currency,
        validUntil,
        terms: src.terms,
        preparedById: user.id,
        items: {
          create: src.items.map((it, i) => ({
            catalogueItemId: it.catalogueItemId ?? null,
            descriptionSnapshot: it.descriptionSnapshot,
            specsSnapshot: (it.specsSnapshot ?? {}) as object,
            qty: it.qty,
            unitPrice: it.unitPrice,
            lineTotal: it.lineTotal,
            selectionNote: it.selectionNote ?? null,
            sortOrder: it.sortOrder ?? i,
          })),
        },
      },
    });
  });

  revalidatePath("/quotations");
  redirect(`/quotations/${created.id}`);
}

/**
 * Given a set of line items (as being built), find existing quotations with the
 * identical item set — used by the builder's live "duplicate" banner.
 */
export async function checkDuplicateQuote(
  items: { specsSnapshot: Record<string, unknown>; qty: number; catalogueItemId: string | null; unitPrice: number; lineTotal?: number }[],
  excludeQuotationId?: string,
): Promise<DuplicateMatch[]> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const totals = computeTotals(items.map((i) => ({ qty: i.qty, unitPrice: i.unitPrice, lineTotal: i.lineTotal })));
  return findDuplicateQuotes({
    items: items.map((i) => ({ specsSnapshot: i.specsSnapshot, qty: i.qty, catalogueItemId: i.catalogueItemId })),
    subtotal: totals.subtotal,
    excludeQuotationId,
  });
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

const saleDocSchema = z.object({ path: z.string(), name: z.string(), uploadedAt: z.string() });
const saleSchema = z.object({
  arrangement: z.enum(["downpayment_full", "downpayment_progress", "terms"]),
  po: saleDocSchema.nullable().optional(),
  payments: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["down", "full", "progress", "ewt"]),
        amount: z.number().nonnegative(),
        date: z.string(),
        proof: saleDocSchema.nullable().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
  docs: z.record(z.array(saleDocSchema)).optional().default({}),
  note: z.string().trim().max(5000).optional().default(""),
});

/**
 * Record (or update) a sale on a quotation: the payment arrangement, the PO, and
 * the payments collected so far (each with its proof). The inquiry is marked WON
 * only when the sale is confirmed — a PO is attached and, unless on terms, at
 * least one payment exists. The preparer or an admin may record it.
 */
export async function recordSale(quotationId: string, input: z.infer<typeof saleSchema>) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const data = saleSchema.parse(input);
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: {
      id: true,
      inquiryId: true,
      preparedById: true,
      classification: true,
      quoteNumber: true,
      inquiry: { select: { customerId: true, customer: { select: { company: true } } } },
    },
  });
  if (!quote) throw new Error("Quotation not found");
  // The preparer, the current sales in-charge (after a transfer), or an admin.
  const ownsQuote = quote.preparedById === user.id || (await isCurrentAccountOwner(quote.inquiry.customerId, user.id));
  if (!ownsQuote && !isAdmin(user))
    throw new Error("Only the preparer, the current sales in-charge or an admin can record this sale.");

  const cls = (quote.classification as Record<string, unknown>) ?? {};
  const existing = saleFromClassification(cls);
  // Deposit-slip rule: a payment backed by a non-machine-validated / non-computer
  // -generated proof may only be saved by an admin; a validated slip's date +
  // amount are authoritative (the payment follows the slip). Throws for a
  // blocked non-admin.
  const grandfatheredIds = new Set((existing?.payments ?? []).map((p) => p.id));
  // Admin / accounting validate payment figures (and can correct a mis-read slip).
  const canOverride = isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting");
  const payments = applyPaymentSlipRules(cls, data.payments as SalePayment[], { canOverride, grandfatheredIds });
  const sale: SaleRecord = { ...data, payments, recordedById: user.id, soldAt: existing?.soldAt };
  const confirmed = isSaleConfirmed(sale);
  sale.soldAt = confirmed ? sale.soldAt ?? new Date().toISOString() : undefined;

  await prisma.$transaction([
    prisma.quotation.update({
      where: { id: quotationId },
      data: { classification: { ...cls, sale } as unknown as Prisma.InputJsonObject },
    }),
    prisma.inquiry.update({
      where: { id: quote.inquiryId },
      data: { status: confirmed ? "WON" : "SENT" },
    }),
  ]);
  if (confirmed) {
    await logActivity(user, {
      action: "sale.recorded",
      category: "quotation",
      summary: `Sale won — ${quote.inquiry?.customer?.company ?? "customer"} (${quote.quoteNumber})`,
      entity: "quotation",
      entityId: quotationId,
      href: `/quotations/${quotationId}`,
    });
  }
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/dashboard");
}

/** Remove the sale record from a quotation (and return the inquiry to SENT). */
export async function clearSale(quotationId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, inquiryId: true, preparedById: true, classification: true },
  });
  if (!quote) throw new Error("Quotation not found");
  // Clearing a sale is an accounting / admin action.
  const assignments = await getWorkflowRoles();
  if (!isAdmin(user) && !userHasWorkflowRole(assignments, user.id, "accounting")) {
    throw new Error("Only accounting or an admin can clear this sale.");
  }
  const cls = (quote.classification as Record<string, unknown>) ?? {};
  await prisma.$transaction([
    prisma.quotation.update({
      where: { id: quotationId },
      data: { classification: { ...cls, sale: null } as Prisma.InputJsonObject },
    }),
    prisma.inquiry.update({ where: { id: quote.inquiryId }, data: { status: "SENT" } }),
  ]);
  revalidatePath(`/quotations/${quotationId}`);
  revalidatePath("/dashboard");
}
