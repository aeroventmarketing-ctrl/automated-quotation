"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import { buildCommissions, allDeals, isPayable, type CommissionDealKind, type CommissionPayeeKind } from "@/lib/sales-commission";

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
export async function payDealCommission(
  kind: CommissionDealKind,
  refId: string,
  payeeKind: CommissionPayeeKind,
  paid: boolean,
): Promise<void> {
  const user = await assertAccounting();
  const deal = allDeals(await buildCommissions()).find(
    (d) => d.kind === kind && d.refId === refId && d.payeeKind === payeeKind,
  );
  if (!deal) throw new Error("That sale is no longer in the commission list.");
  if (paid && !deal.approved) {
    throw new Error("This commission isn't approved yet — the month must clear ₱1,000,000 and the client must have fully paid.");
  }

  // One sale can owe two people, so the payout row is keyed by (sale, payee):
  // "base" is the rep's 1.5%, "override" the Sales Head's 0.25% on the same sale.
  const ref = kind === "order" ? { quotationId: refId } : { counterSaleId: refId };
  const where = kind === "order"
    ? { quotationId_kind: { quotationId: refId, kind: payeeKind } }
    : { counterSaleId_kind: { counterSaleId: refId, kind: payeeKind } };
  const payout = paid ? { paid: true, paidAt: new Date(), paidByName: user.name } : { paid: false, paidAt: null, paidByName: null };
  const row = await prisma.commission.upsert({
    where,
    create: {
      ...ref,
      kind: payeeKind,
      salespersonId: deal.salespersonId,
      salespersonName: deal.salespersonName,
      // The row records what was earned: the NET base and the rate on it.
      orderValue: deal.net,
      ratePct: deal.ratePct,
      amount: deal.amount,
      salesMonth: deal.salesMonth,
      ...payout,
    },
    // Keep the row's figures in step with the live computation — a revised or
    // late-paid deal must not pay out yesterday's amount.
    update: { orderValue: deal.net, ratePct: deal.ratePct, amount: deal.amount, salesMonth: deal.salesMonth, ...payout },
  });

  const what = payeeKind === "override" ? `override on ${deal.sourceSalespersonName ?? "a sale"}` : "commission";
  await logActivity(user, {
    action: paid ? "commission.paid" : "commission.unpaid",
    category: "commission",
    summary: `Commission ${what} marked ${paid ? "paid" : "unpaid"} — ${deal.salespersonName} · ${deal.refLabel} (${peso(deal.amount)})`,
    entity: "commission",
    entityId: row.id,
    href: `/commissions#commission-${kind}-${refId}-${payeeKind}`,
  });
  revalidatePath("/commissions");
  revalidatePath("/management");
  revalidatePath(deal.href);
}

/**
 * Settle a whole cash voucher: mark EVERY commission a salesperson is currently
 * owed as paid, in one go.
 *
 * The voucher is per person, not per order — *"Total every approved inquiry and
 * make a single cash voucher per sales personnel"* — so releasing it one row at a
 * time would leave a half-paid voucher whenever someone was interrupted. Each row
 * still gets its own payout record; this only spares Accounting fifteen clicks.
 *
 * The set is recomputed here, so it is whatever the person is owed at the moment
 * of settlement — never a stale list posted from the browser.
 */
export async function payAllForSalesperson(salespersonId: string): Promise<{ paid: number; total: number; error?: string }> {
  const user = await assertAccounting();
  const due = allDeals(await buildCommissions({ salespersonId })).filter(isPayable);
  if (due.length === 0) return { paid: 0, total: 0, error: "Nothing is awaiting payout for this salesperson." };

  const now = new Date();
  for (const d of due) {
    const ref = d.kind === "order" ? { quotationId: d.refId } : { counterSaleId: d.refId };
    const where = d.kind === "order"
      ? { quotationId_kind: { quotationId: d.refId, kind: d.payeeKind } }
      : { counterSaleId_kind: { counterSaleId: d.refId, kind: d.payeeKind } };
    const payout = { paid: true, paidAt: now, paidByName: user.name };
    await prisma.commission.upsert({
      where,
      create: {
        ...ref,
        kind: d.payeeKind,
        salespersonId: d.salespersonId,
        salespersonName: d.salespersonName,
        orderValue: d.net,
        ratePct: d.ratePct,
        amount: d.amount,
        salesMonth: d.salesMonth,
        ...payout,
      },
      update: { orderValue: d.net, ratePct: d.ratePct, amount: d.amount, salesMonth: d.salesMonth, ...payout },
    });
  }

  const total = due.reduce((a, d) => a + d.amount, 0);
  await logActivity(user, {
    action: "commission.voucher.paid",
    category: "commission",
    summary: `Commission voucher released — ${due[0].salespersonName} · ${due.length} item${due.length === 1 ? "" : "s"} (${peso(total)})`,
    entity: "commission",
    entityId: salespersonId,
    href: "/commissions",
  });
  revalidatePath("/commissions");
  revalidatePath("/management");
  revalidatePath("/my-dashboard");
  return { paid: due.length, total };
}
