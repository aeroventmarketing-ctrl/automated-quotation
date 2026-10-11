"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { readOrderWorkflow } from "@/lib/order-workflow";
import { purchaserPlanAccess } from "@/lib/purchaser-plan-access";
import { isPlanType, isPlanOpenMrf, normaliseDueDate, type PlanEdit, type PlanEditField } from "@/lib/purchaser-plan";

/**
 * A failure is RETURNED, not thrown: a thrown Server Action error has its message
 * stripped in a production build, and "the migration hasn't been run" is exactly
 * the kind of reason a person needs to read.
 *
 * On success `edit` is the change just recorded — or null when the value was
 * already what was sent, in which case nothing was written at all.
 */
export type PlanSaveResult =
  | { ok: true; byName: string; at: string; edit: PlanEdit | null }
  | { ok: false; error: string };

async function guard(quotationId: string, mrfId: string): Promise<{ id: string; name: string }> {
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
  return { id: user.id, name: user.name };
}

const asResult = async (fn: () => Promise<Extract<PlanSaveResult, { ok: true }>>): Promise<PlanSaveResult> => {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    // Missing table → say what to do, not a Prisma stack.
    if (/PurchaserPlan(Entry|Edit)|does not exist|P2021/i.test(msg)) {
      return { ok: false, error: "The Purchaser Plan isn't set up in the database yet — run migration 0060_purchaser_plan." };
    }
    return { ok: false, error: msg };
  }
};

/**
 * Write one field and its line in the edit trail, together.
 *
 * The owner: *"Record every person who made the edit for tracking purposes."*
 * The entry keeps the latest value and who set it; `PurchaserPlanEdit` keeps
 * every change — who, when, from what, to what — and is only ever appended to.
 * Both are written in ONE transaction, so there is no state in which a value
 * changed and the trail doesn't say who changed it.
 *
 * Setting a field to the value it already holds writes nothing: a trail full of
 * "Oct 24 → Oct 24" would bury the changes that matter.
 */
async function saveField(
  quotationId: string,
  mrfId: string,
  field: PlanEditField,
  value: string | null,
): Promise<Extract<PlanSaveResult, { ok: true }>> {
  const who = await guard(quotationId, mrfId);
  const at = new Date();
  const edit = await prisma.$transaction(async (tx) => {
    const cur = await tx.purchaserPlanEntry.findUnique({ where: { mrfId } });
    const from = (field === "type" ? cur?.type : cur?.clientDueDate) ?? "";
    const to = value ?? "";
    if (from === to) return null;
    const data =
      field === "type"
        ? { type: value, typeByName: who.name, typeAt: at }
        : { clientDueDate: value, clientDueByName: who.name, clientDueAt: at };
    await tx.purchaserPlanEntry.upsert({ where: { mrfId }, update: data, create: { quotationId, mrfId, ...data } });
    await tx.purchaserPlanEdit.create({ data: { quotationId, mrfId, field, fromValue: from, toValue: to, byId: who.id, byName: who.name, at } });
    return { field, from, to, byName: who.name, at: at.toISOString() } satisfies PlanEdit;
  });
  if (edit) revalidatePath("/purchaser-plan");
  return { ok: true, byName: who.name, at: at.toISOString(), edit };
}

/** Set (or clear, with "") an MRF's Type. */
export async function savePlanType(quotationId: string, mrfId: string, type: string): Promise<PlanSaveResult> {
  return asResult(async () => {
    if (type !== "" && !isPlanType(type)) throw new Error("Choose Purchase to supplier or For fabrication.");
    return saveField(quotationId, mrfId, "type", type || null);
  });
}

/** Set (or clear, with "") an MRF's Client due date (YYYY-MM-DD). */
export async function savePlanClientDue(quotationId: string, mrfId: string, ymd: string): Promise<PlanSaveResult> {
  return asResult(async () => {
    const day = normaliseDueDate(ymd);
    if (ymd.trim() !== "" && !day) throw new Error("Enter a valid date.");
    return saveField(quotationId, mrfId, "clientDue", day);
  });
}
