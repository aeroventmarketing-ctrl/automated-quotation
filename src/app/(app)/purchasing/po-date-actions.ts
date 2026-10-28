"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getWorkflowRoles } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import { coercePurchaseOrder } from "@/lib/purchase-order";
import { poMemberIds } from "@/lib/purchase-batch";
import { normalisePoDate, poDateYmd, PO_DATE_ACTION } from "@/lib/po-date";
import { canChangePoDate } from "@/lib/po-date-access";

export type PoDateResult = { ok: true } | { ok: false; error: string };

/**
 * Change a PO's date — and only its date — at any stage. See lib/po-date.
 *
 * One statement per call sets `po.date` on every request carrying the PO (all
 * members of a combined PO), leaving the rest of the PO JSON untouched, so a
 * later read of the PO, the 2307 and the registers all see the new date.
 */
export async function changePoDate(purchaseRequestId: string, ymd: string, reason: string): Promise<PoDateResult> {
  try {
    const user = await getCurrentUser();
    if (!canChangePoDate(user, await getWorkflowRoles())) {
      return { ok: false, error: "Only an admin, the Payment Approver or the Purchaser can change a PO date." };
    }
    const to = normalisePoDate(ymd);
    if (!to) return { ok: false, error: "Pick a valid date." };
    const why = (reason ?? "").trim();
    if (!why) return { ok: false, error: "Say why the date is changing." };
    if (why.length > 300) return { ok: false, error: "Keep the reason under 300 characters." };

    const pr = await prisma.purchaseRequest.findUnique({ where: { id: purchaseRequestId }, select: { id: true, po: true, quotationId: true } });
    if (!pr) return { ok: false, error: "Purchase request not found." };
    const po = coercePurchaseOrder(pr.po);
    if (!po) return { ok: false, error: "There's no purchase order on this request yet." };
    const from = poDateYmd(po.date);
    if (from === to) return { ok: false, error: "That's already the PO date." };

    const members = poMemberIds(pr.po);
    const ids = members.length ? [...new Set([pr.id, ...members])] : [pr.id];
    await prisma.$executeRaw`
      update "PurchaseRequest"
      set "po" = jsonb_set("po", '{date}', to_jsonb(${to}::text)), "updatedAt" = now()
      where "id" = any(${ids}) and "po" is not null
    `;
    await logActivity(user, {
      action: PO_DATE_ACTION,
      category: "purchase",
      summary: `${po.poNumber}: PO date changed ${from || "—"} → ${to} — ${why}`,
      entity: "purchase",
      entityId: pr.id,
      href: `/purchasing?req=${pr.id}`,
      meta: { from, to, reason: why, prIds: ids, poNumber: po.poNumber },
    });

    revalidatePath("/purchasing");
    revalidatePath("/checks");
    revalidatePath("/reports/ewt-summary");
    if (pr.quotationId) revalidatePath(`/orders/${pr.quotationId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't change the PO date." };
  }
}
