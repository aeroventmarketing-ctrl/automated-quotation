"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import { refuse, done, type ActionResult } from "@/lib/action-result";
import { round2 } from "@/lib/quote";
import { buildCommissionsFresh, allDeals, canMarkPaid, markPaidOpensYMD, MARK_PAID_LEAD_DAYS, commissionToday, type CommissionDealKind, type CommissionPayeeKind } from "@/lib/sales-commission";

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
  const deal = allDeals(await buildCommissionsFresh()).find(
    (d) => d.kind === kind && d.refId === refId && d.payeeKind === payeeKind,
  );
  if (!deal) throw new Error("That sale is no longer in the commission list.");
  if (paid && !deal.approved) {
    throw new Error("This commission isn't approved yet — the month must clear ₱1,000,000 and the client must have fully paid.");
  }
  // The five-day window, enforced HERE and not only on the button. The button is
  // a hint; this is the rule. Without it, rule 4 would hold only for as long as
  // nobody thought to call the action directly.
  if (paid && !canMarkPaid(deal, commissionToday())) {
    const opens = markPaidOpensYMD(deal.payoutYMD);
    throw new Error(
      `This commission releases on ${deal.payoutYMD} — it can be paid from ${opens}, ${MARK_PAID_LEAD_DAYS} days before.`,
    );
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
 *
 * Gated by `canMarkPaid`, the same five-day window as the single-row button.
 * Bulk and single are the same decision made at different scales; if they
 * disagreed, which one Accounting happened to click would change what rule
 * applied.
 */
export async function payAllForSalesperson(salespersonId: string): Promise<{ paid: number; total: number; error?: string }> {
  const user = await assertAccounting();
  const today = commissionToday();
  const due = allDeals(await buildCommissionsFresh({ salespersonId })).filter((d) => canMarkPaid(d, today));
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

/**
 * The salesperson's own confirmation that the money reached them.
 *
 * The owner: *"show a link in every sales personnel. Link can be clickable by
 * sales personnel when receiving commissions. Once clicked it will be the proof
 * that the sales personnel received the amount."*
 *
 * **There is no role check here, and that is the point.** Every other action in
 * this file asks "may you do this job?"; this one asks "is this your money?".
 * Accounting released it and an admin can do anything else — neither may sign
 * for it. A receipt the payer can write on the payee's behalf proves nothing.
 *
 * One click covers everything currently released and unconfirmed, because one
 * cash voucher is what the person is handed. Each row still gets its own stamp,
 * so a single line can be checked later on its own.
 *
 * The set is recomputed here from the payee's id — never posted from the
 * browser — so this cannot be pointed at somebody else's row.
 */
export async function confirmCommissionReceipt(): Promise<ActionResult & { count?: number; total?: number }> {
  const user = await getCurrentUser();
  if (!user) return refuse("Please sign in again.");

  const rows = await prisma.commission
    .findMany({ where: { salespersonId: user.id, paid: true, receivedAt: null }, select: { id: true, amount: true } })
    .catch(() => null);
  if (rows == null) return refuse("The commissions table isn't set up yet — run migration 0055 in Supabase.");
  if (rows.length === 0) return refuse("There's nothing waiting for your confirmation.");

  const total = round2(rows.reduce((a, r) => a + Number(r.amount), 0));
  const at = new Date();
  // `receivedAt: null` in the filter as well as the read: two taps on a slow
  // connection must not restamp a receipt with a later time. The first write
  // wins and the second matches nothing.
  const stamped = await prisma.commission.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, salespersonId: user.id, paid: true, receivedAt: null },
    data: { receivedAt: at, receivedById: user.id, receivedByName: user.name },
  });
  if (stamped.count === 0) return refuse("Those commissions were already confirmed.");

  await logActivity(user, {
    action: "commission.received",
    category: "commission",
    summary: `${user.name} confirmed receiving ${peso(total)} in commissions (${stamped.count} ${stamped.count === 1 ? "payout" : "payouts"})`,
    entity: "commission",
    entityId: rows[0].id,
    href: "/commissions",
  });
  revalidatePath("/commissions");
  revalidatePath("/my-dashboard");
  return { ...done, count: stamped.count, total };
}
