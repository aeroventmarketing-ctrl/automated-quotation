/**
 * Scan for quotations that inherited another order's state.
 *
 * READ ONLY — this script never writes. Run it against production to find out
 * how far the "duplicate carries the source's workflow" bug reached:
 *
 *   DATABASE_URL=... DIRECT_URL=... npx tsx scripts/scan-inherited-workflows.ts
 *
 * Background: `duplicateQuotationToCustomer` copies the source quotation's whole
 * `classification` JSON and deletes only `sale`, `revision` and `revisions`. The
 * order workflow lives in that same blob at `classification.workflow`, so a
 * duplicate is created already carrying the source's stage, approval stamps, job
 * orders, MRFs, delivery batches and closing documents — and nothing resets it.
 *
 * HOW A HIT IS PROVEN, rather than guessed:
 *
 *  1. TIME TRAVEL — a workflow stamp dated BEFORE the quotation itself was
 *     created cannot be that order's own work. This is the decisive test: it
 *     needs no knowledge of where the row came from, so it catches inherited
 *     state whatever route produced it, and a duplicate that was later worked on
 *     legitimately still shows its inherited stamps.
 *
 *  2. FOREIGN FILE PATHS — `saleDocReads` and `slipValidations` are keyed by
 *     storage path, and every path for an order must start `sales/<that order's
 *     id>/`. A key pointing somewhere else came from another order.
 *
 * Neither test can fire on a clean order, so anything listed here is real.
 */
import { PrismaClient } from "@prisma/client";
import { readOrderWorkflow } from "../src/lib/order-workflow";

const prisma = new PrismaClient();

/** Pull every ISO timestamp out of the workflow blob, with a label for each. */
function stampsIn(value: unknown, path: string[] = [], out: { at: Date; where: string }[] = []) {
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

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");

async function main() {
  const quotes = await prisma.quotation.findMany({
    select: {
      id: true,
      quoteNumber: true,
      status: true,
      createdAt: true,
      classification: true,
      inquiry: { select: { notes: true, customer: { select: { company: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Scanned ${quotes.length} quotations.\n`);

  let hits = 0;
  for (const q of quotes) {
    const cls = (q.classification as Record<string, unknown> | null) ?? {};
    if (!cls.workflow && !cls.saleDocReads && !cls.slipValidations) continue;

    const wf = readOrderWorkflow(q.classification);
    // A second of slack: the workflow is written moments after the row.
    const floor = new Date(q.createdAt.getTime() - 1000);
    const early = stampsIn(cls.workflow).filter((s) => s.at < floor).sort((a, b) => +a.at - +b.at);

    const foreign: string[] = [];
    for (const key of ["saleDocReads", "slipValidations"] as const) {
      const bag = cls[key];
      if (bag && typeof bag === "object") {
        for (const p of Object.keys(bag as Record<string, unknown>)) {
          if (!p.startsWith(`sales/${q.id}/`)) foreign.push(`${key}: ${p}`);
        }
      }
    }

    if (early.length === 0 && foreign.length === 0) continue;
    hits++;

    // Quote numbers contain spaces ("2026 - AFBM00002892J"), so take the rest
    // of the line rather than the first whitespace-delimited token.
    const from = /Duplicated from (.+)$/m.exec(q.inquiry?.notes ?? "")?.[1]?.trim();
    console.log(`${q.quoteNumber}  [${q.status}]  ${q.inquiry?.customer?.company ?? "—"}`);
    console.log(`  created      ${fmt(q.createdAt)}${from ? `   (duplicated from ${from})` : ""}`);
    console.log(`  stage now    ${wf.stage}`);
    if (early.length) {
      console.log(`  INHERITED    ${early.length} stamp(s) predate this quotation — earliest ${fmt(early[0].at)} at "${early[0].where}"`);
      for (const s of early.slice(0, 6)) console.log(`                 ${fmt(s.at)}  ${s.where}`);
      if (early.length > 6) console.log(`                 …and ${early.length - 6} more`);
    }
    for (const f of foreign.slice(0, 6)) console.log(`  FOREIGN FILE ${f}`);
    if (foreign.length > 6) console.log(`               …and ${foreign.length - 6} more`);
    console.log();
  }

  console.log(hits === 0 ? "No quotations carry inherited state." : `${hits} quotation(s) carry inherited state.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
