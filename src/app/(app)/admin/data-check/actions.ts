"use server";

/**
 * Repair for an order that inherited another order's workflow.
 *
 * This is the ONE write in Data check, and it is deliberately narrow: it clears
 * a wholly-inherited workflow so the order restarts at the beginning of Phase 1,
 * and removes document-read entries that point at another order's files.
 *
 * THE GUARD IS THE POINT. It refuses unless EVERY dated step in the workflow
 * predates the quotation — i.e. the order has done none of its own work. The
 * scan also finds orders that inherited one early stamp and then ran the rest of
 * the workflow legitimately (a real case: two closed orders carrying one
 * borrowed `doc_check`), and clearing those would destroy weeks of genuine
 * production and delivery records. The guard is recomputed here from the
 * database, never taken from the page, so a stale or edited request cannot get
 * past it.
 *
 * Nothing else is touched. The order's own `sale` — its payments and arrangement
 * — is its own and stays.
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { scanInheritedWorkflows } from "@/lib/inherited-workflow-scan";
import { Prisma } from "@prisma/client";
import { logActivity } from "@/lib/activity-log";
import { buildCatalogueSkuIndex } from "@/lib/pr-item-skus";
import { correctSkus, checkArticleSku } from "@/lib/item-sku-align";
import { correctPoLineSkus } from "@/lib/sku-drift-audit";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { poMemberIds } from "@/lib/purchase-batch";

export interface ResetResult {
  quoteNumber: string;
  removedStamps: number;
  removedPaths: number;
}

export async function resetInheritedWorkflow(quotationId: string): Promise<ResetResult> {
  const user = await getCurrentUser();
  if (!isAdmin(user)) throw new Error("Admin access required");

  const { findings } = await scanInheritedWorkflows();
  const finding = findings.find((f) => f.quotationId === quotationId);
  if (!finding) {
    throw new Error("That order is not carrying inherited state — nothing to reset.");
  }
  if (finding.totalStamps === 0 || finding.stamps.length !== finding.totalStamps) {
    throw new Error(
      `${finding.quoteNumber} did ${finding.totalStamps - finding.stamps.length} of its own workflow steps, ` +
        "so its workflow is not purely inherited and will not be cleared. Fix it by hand instead.",
    );
  }

  const quote = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { classification: true, quoteNumber: true },
  });
  if (!quote) throw new Error("Order not found.");
  const cls = { ...((quote.classification as Record<string, unknown> | null) ?? {}) };

  // The workflow goes entirely: readOrderWorkflow falls back to the opening
  // stage when the key is absent, which is exactly a fresh start.
  delete cls.workflow;

  // Drop only the document reads that belong to another order; any of this
  // order's own are left alone.
  for (const field of ["saleDocReads", "slipValidations"] as const) {
    const bag = cls[field];
    if (!bag || typeof bag !== "object") continue;
    const kept: Record<string, unknown> = {};
    for (const [path, v] of Object.entries(bag as Record<string, unknown>)) {
      if (path.startsWith(`sales/${quotationId}/`)) kept[path] = v;
    }
    if (Object.keys(kept).length === 0) delete cls[field];
    else cls[field] = kept;
  }

  // Leave a record rather than deleting silently — someone will ask later why a
  // closed order went back to the start.
  const history = Array.isArray(cls.workflowResets) ? (cls.workflowResets as unknown[]) : [];
  cls.workflowResets = [
    ...history,
    {
      at: new Date().toISOString(),
      byName: user!.name,
      reason: "Workflow was inherited from another order via quotation duplication",
      inheritedFrom: finding.duplicatedFrom,
      removedStamps: finding.stamps.length,
      removedPaths: finding.foreignPaths.length,
    },
  ];

  await prisma.quotation.update({
    where: { id: quotationId },
    data: { classification: cls as object },
  });

  revalidatePath("/admin/data-check");
  revalidatePath(`/orders/${quotationId}`);
  revalidatePath(`/quotations/${quotationId}`);

  return {
    quoteNumber: quote.quoteNumber,
    removedStamps: finding.stamps.length,
    removedPaths: finding.foreignPaths.length,
  };
}

/**
 * Correct the per-line codes the SKU-drift check found (lib/sku-drift-audit):
 * on the request, and on its PO's lines — on every request of a combined PO,
 * which share one PO. Recomputed here from the database, never taken from the
 * page, and only clear contradictions are changed. Admin only; each repair is
 * recorded in the activity log.
 */
export async function repairSkuDrift(prIds: string[]): Promise<{ requests: number; lines: number }> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Admin access required");
  const ids = [...new Set((prIds ?? []).filter((x): x is string => typeof x === "string" && !!x))];
  if (ids.length === 0) return { requests: 0, lines: 0 };
  const index = await buildCatalogueSkuIndex();
  let requests = 0;
  let lines = 0;
  for (const id of ids) {
    const pr = await prisma.purchaseRequest.findUnique({ where: { id }, select: { id: true, items: true, itemSkus: true, po: true, quotationId: true } });
    if (!pr) continue;
    const items = Array.isArray(pr.items) ? (pr.items as unknown[]).map(String) : [];
    const req = Array.isArray(pr.itemSkus) ? correctSkus(items, pr.itemSkus as unknown[], index) : { skus: [], fixed: [] };
    const po = coercePurchaseOrder(pr.po);
    const poFix = po ? correctPoLineSkus(po.lines, index) : { lines: [], fixed: [] };
    if (req.fixed.length === 0 && poFix.fixed.length === 0) continue;
    await prisma.$transaction(async (tx) => {
      if (req.fixed.length) await tx.purchaseRequest.update({ where: { id }, data: { itemSkus: req.skus as Prisma.InputJsonValue } });
      if (poFix.fixed.length && pr.po && typeof pr.po === "object") {
        const memberIds = poMemberIds(pr.po);
        const targets = memberIds.length ? memberIds : [id];
        for (const t of targets) {
          const row = await tx.purchaseRequest.findUnique({ where: { id: t }, select: { po: true } });
          if (!row?.po || typeof row.po !== "object") continue;
          // On the stored lines themselves, so nothing else in the PO is touched.
          const raw = row.po as Record<string, unknown>;
          const rawLines = Array.isArray(raw.lines) ? (raw.lines as Record<string, unknown>[]) : [];
          const nextLines = rawLines.map((l) => {
            const c = checkArticleSku(String(l?.description ?? ""), typeof l?.sku === "string" ? l.sku : "", index);
            return c.status === "mismatch" ? { ...l, sku: c.expected } : l;
          });
          await tx.purchaseRequest.update({ where: { id: t }, data: { po: { ...raw, lines: nextLines } as Prisma.InputJsonValue } });
        }
      }
    });
    requests++;
    lines += req.fixed.length + poFix.fixed.length;
    const what = [...req.fixed.map((f) => `${f.item}: ${f.from} → ${f.to}`), ...poFix.fixed.map((f) => `PO ${f.description}: ${f.from} → ${f.to}`)].join("; ");
    await logActivity(user, {
      action: "purchase.sku_repair",
      category: "purchase",
      summary: `Corrected SKUs — ${what}`.slice(0, 900),
      entity: "purchase",
      entityId: id,
      href: `/purchasing?req=${id}`,
    });
    if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
  }
  revalidatePath("/admin/data-check");
  revalidatePath("/purchasing");
  return { requests, lines };
}
