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
