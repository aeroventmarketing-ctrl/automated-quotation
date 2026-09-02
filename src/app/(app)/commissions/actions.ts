"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import { buildCommissions, allDeals, COMMISSION_RATE_PCT, type CommissionDealKind } from "@/lib/sales-commission";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function assertAccounting() {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  if (!(isAdmin(user) || userHasWorkflowRole(await getWorkflowRoles(), user.id, "accounting" as WorkflowRoleKey))) {
    throw new Error("Only Accounting or an admin can update commission payments.");
  }
  return user;
}

/** Mark an existing commission row paid / unpaid. Accounting or admin only. */
export async function markCommissionPaid(commissionId: string, paid: boolean): Promise<void> {
  const user = await assertAccounting();
  const c = await prisma.commission.update({
    where: { id: commissionId },
    data: paid
      ? { paid: true, paidAt: new Date(), paidByName: user.name }
      : { paid: false, paidAt: null, paidByName: null },
  });
  await logActivity(user, {
    action: paid ? "commission.paid" : "commission.unpaid",
    category: "commission",
    summary: `Commission marked ${paid ? "paid" : "unpaid"} — ${c.salespersonName} (${peso(Number(c.amount))})`,
    entity: "commission",
    entityId: commissionId,
    href: `/commissions#commission-${commissionId}`,
  });
  revalidatePath("/commissions");
  revalidatePath("/management");
}

/**
 * Record a commission payout against a DEAL (an order or a counter sale) rather
 * than against a pre-existing `Commission` row.
 *
 * Entitlement is computed live from the confirmed sales, so a deal can be
 * payable before anyone created a row for it — the old row was only written when
 * the order closed. This recomputes the deal server-side (the caller passes an
 * id, never an amount) and upserts the row it is paying, so the payout record
 * always carries the figure that was actually earned.
 */
export async function payDealCommission(kind: CommissionDealKind, refId: string, paid: boolean): Promise<void> {
  const user = await assertAccounting();
  const deal = allDeals(await buildCommissions()).find((d) => d.kind === kind && d.refId === refId);
  if (!deal) throw new Error("That sale is no longer in the commission list.");
  if (paid && !deal.approved) {
    throw new Error("This commission isn't approved yet — the month must clear ₱1,000,000 and the client must have fully paid.");
  }

  const where = kind === "order" ? { quotationId: refId } : { counterSaleId: refId };
  const payout = paid ? { paid: true, paidAt: new Date(), paidByName: user.name } : { paid: false, paidAt: null, paidByName: null };
  const row = await prisma.commission.upsert({
    where: where as { quotationId: string } | { counterSaleId: string },
    create: {
      ...where,
      salespersonId: deal.salespersonId,
      salespersonName: deal.salespersonName,
      // The row records what was earned: the NET base and the 1.5% on it.
      orderValue: deal.net,
      ratePct: COMMISSION_RATE_PCT,
      amount: deal.amount,
      salesMonth: deal.salesMonth,
      ...payout,
    },
    // Keep the row's figures in step with the live computation — a revised or
    // late-paid deal must not pay out yesterday's amount.
    update: { orderValue: deal.net, amount: deal.amount, salesMonth: deal.salesMonth, ...payout },
  });

  await logActivity(user, {
    action: paid ? "commission.paid" : "commission.unpaid",
    category: "commission",
    summary: `Commission marked ${paid ? "paid" : "unpaid"} — ${deal.salespersonName} · ${deal.refLabel} (${peso(deal.amount)})`,
    entity: "commission",
    entityId: row.id,
    href: `/commissions#commission-${kind}-${refId}`,
  });
  revalidatePath("/commissions");
  revalidatePath("/management");
  revalidatePath(deal.href);
}
