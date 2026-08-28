/**
 * Find orders that are carrying another order's state.
 *
 * READ ONLY. Nothing here writes; it is a diagnostic.
 *
 * Background: `duplicateQuotationToCustomer` copies the source quotation's whole
 * `classification` JSON and deletes only `sale`, `revision` and `revisions`. The
 * order workflow lives in that same blob at `classification.workflow`, so a
 * duplicate is born already holding the source's stage, approval stamps, job
 * orders, MRFs, delivery batches and closing documents — and nothing anywhere
 * resets it, so the new order can show as finished before any work happens.
 *
 * HOW A HIT IS PROVEN, rather than guessed:
 *
 *  1. TIME TRAVEL — a workflow stamp dated BEFORE the quotation itself existed
 *     cannot be that order's own work. This is the decisive test: it needs no
 *     knowledge of where the row came from, so it catches inherited state
 *     whatever route produced it, and a duplicate that was later worked on
 *     legitimately still shows the stamps it inherited.
 *
 *  2. FOREIGN FILE PATHS — `saleDocReads` and `slipValidations` are keyed by
 *     storage path, and every path belonging to an order starts
 *     `sales/<that order's id>/`. A key pointing elsewhere came from elsewhere.
 *
 * Neither test can fire on a clean order, so every row returned is real.
 */
import { prisma } from "@/lib/db";
import { readOrderWorkflow, type OrderStage } from "@/lib/order-workflow";

export interface InheritedStamp {
  /** When the stamp claims the step happened. */
  at: string;
  /** Where it sits in the workflow blob, e.g. "approvals.paymentCleared.at". */
  where: string;
}

export interface InheritedFinding {
  quotationId: string;
  quoteNumber: string;
  company: string;
  status: string;
  createdAt: string;
  /** The source quote, when the inquiry note records one. */
  duplicatedFrom: string | null;
  /** The stage this order is sitting at right now. */
  stage: OrderStage;
  /** Stamps that predate the quotation — impossible unless inherited. */
  stamps: InheritedStamp[];
  /**
   * Every dated event in the workflow, inherited or not. Read against
   * `stamps.length` this is the whole diagnosis: all of them inherited means the
   * order never ran its own workflow and needs restarting, while one inherited
   * out of many means the order was worked properly and merely started with a
   * step it did not earn. The two need completely different repairs.
   */
  totalStamps: number;
  /** Document-read keys pointing at another order's files. */
  foreignPaths: { field: string; path: string }[];
}

export interface InheritedScan {
  scanned: number;
  findings: InheritedFinding[];
}

/** Every ISO timestamp inside the workflow blob, each with a dotted path. */
function stampsIn(
  value: unknown,
  path: string[] = [],
  out: { at: Date; where: string }[] = [],
): { at: Date; where: string }[] {
  if (!value || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!Number.isNaN(d.getTime())) out.push({ at: d, where: [...path, k].join(".") });
    } else if (v && typeof v === "object") {
      stampsIn(v, [...path, k], out);
    }
  }
  return out;
}

export async function scanInheritedWorkflows(): Promise<InheritedScan> {
  const quotes = await prisma.quotation.findMany({
    select: {
      id: true,
      quoteNumber: true,
      status: true,
      createdAt: true,
      classification: true,
      inquiry: { select: { notes: true, customer: { select: { company: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  const findings: InheritedFinding[] = [];

  for (const q of quotes) {
    const cls = (q.classification as Record<string, unknown> | null) ?? {};
    if (!cls.workflow && !cls.saleDocReads && !cls.slipValidations) continue;

    // A second of slack: the workflow is written moments after the row itself.
    const floor = new Date(q.createdAt.getTime() - 1000);
    const allStamps = stampsIn(cls.workflow);
    const stamps = allStamps
      .filter((s) => s.at < floor)
      .sort((a, b) => +a.at - +b.at)
      .map((s) => ({ at: s.at.toISOString(), where: s.where }));

    const foreignPaths: { field: string; path: string }[] = [];
    for (const field of ["saleDocReads", "slipValidations"] as const) {
      const bag = cls[field];
      if (bag && typeof bag === "object") {
        for (const p of Object.keys(bag as Record<string, unknown>)) {
          if (!p.startsWith(`sales/${q.id}/`)) foreignPaths.push({ field, path: p });
        }
      }
    }

    if (stamps.length === 0 && foreignPaths.length === 0) continue;

    // Quote numbers contain spaces ("2026 - AFBM00002892J"), so take the rest of
    // the line rather than the first whitespace-delimited token.
    const from = /Duplicated from (.+)$/m.exec(q.inquiry?.notes ?? "")?.[1]?.trim() ?? null;

    findings.push({
      quotationId: q.id,
      quoteNumber: q.quoteNumber,
      company: q.inquiry?.customer?.company ?? "—",
      status: q.status,
      createdAt: q.createdAt.toISOString(),
      duplicatedFrom: from,
      stage: readOrderWorkflow(q.classification).stage,
      stamps,
      totalStamps: allStamps.length,
      foreignPaths,
    });
  }

  return { scanned: quotes.length, findings };
}
