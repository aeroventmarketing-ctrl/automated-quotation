"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { purchaserPlanAccess } from "@/lib/purchaser-plan-access";
import { isPlanType, isPlanOpenMrf, normaliseDueDate } from "@/lib/purchaser-plan";

/**
 * A failure is RETURNED, not thrown: a thrown Server Action error has its message
 * stripped in a production build, and "the migration hasn't been run" is exactly
 * the kind of reason a person needs to read.
 */
export type PlanSaveResult = { ok: true; byName: string; at: string } | { ok: false; error: string };

async function guard(quotationId: string, mrfId: string): Promise<{ name: string }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Please sign in again.");
  if (!purchaserPlanAccess(user, await getWorkflowRoles()).canEdit) {
    throw new Error("Only the Purchaser, an Engineer, the Payment Approver or an admin can edit the Purchaser Plan.");
  }
  // The MRF must really be an open MRF on that order — the ids arrive from a
  // browser, and an entry for an MRF that doesn't exist would be a row nobody
  // can ever see or clear.
  const q = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { classification: true } });
  const m = q ? readOrderWorkflow(q.classification).materialRequests.find((x) => x.id === mrfId) : undefined;
  if (!m) throw new Error("That MRF is no longer on this order.");
  if (!isPlanOpenMrf(m.status)) throw new Error("That MRF is already completed or cancelled.");
  return { name: user.name };
}

const asResult = async (fn: () => Promise<{ byName: string; at: string }>): Promise<PlanSaveResult> => {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    // Missing table → say what to do, not a Prisma stack.
    if (/PurchaserPlanEntry|does not exist|P2021/i.test(msg)) {
      return { ok: false, error: "The Purchaser Plan isn't set up in the database yet — run migration 0060_purchaser_plan." };
    }
    return { ok: false, error: msg };
  }
};

/** Set (or clear, with "") an MRF's Type. Stamped with who and when. */
export async function savePlanType(quotationId: string, mrfId: string, type: string): Promise<PlanSaveResult> {
  return asResult(async () => {
    const { name } = await guard(quotationId, mrfId);
    if (type !== "" && !isPlanType(type)) throw new Error("Choose Purchase to supplier or For fabrication.");
    const at = new Date();
    const data = { type: type || null, typeByName: name, typeAt: at };
    await prisma.purchaserPlanEntry.upsert({ where: { mrfId }, update: data, create: { quotationId, mrfId, ...data } });
    revalidatePath("/purchaser-plan");
    return { byName: name, at: at.toISOString() };
  });
}

/** Set (or clear, with "") an MRF's Client due date (YYYY-MM-DD). Stamped with who and when. */
export async function savePlanClientDue(quotationId: string, mrfId: string, ymd: string): Promise<PlanSaveResult> {
  return asResult(async () => {
    const { name } = await guard(quotationId, mrfId);
    const day = normaliseDueDate(ymd);
    if (ymd.trim() !== "" && !day) throw new Error("Enter a valid date.");
    const at = new Date();
    const data = { clientDueDate: day, clientDueByName: name, clientDueAt: at };
    await prisma.purchaserPlanEntry.upsert({ where: { mrfId }, update: data, create: { quotationId, mrfId, ...data } });
    revalidatePath("/purchaser-plan");
    return { byName: name, at: at.toISOString() };
  });
}
