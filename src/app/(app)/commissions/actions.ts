"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, type WorkflowRoleKey } from "@/lib/workflow-roles";
import { logActivity } from "@/lib/activity-log";
import { refuse, done, type ActionResult } from "@/lib/action-result";
import { round2 } from "@/lib/quote";
import { Prisma } from "@prisma/client";
import { WORKFLOW_ROLE_KEYS } from "@/lib/workflow-roles";
import {
  canAttachCommissionProof,
  cleanProofName,
  coerceProofDocs,
  editProofDocs,
  proofTargets,
  salespersonIdFromProofPath,
  MAX_PROOF_DOCS,
  type ProofEdit,
} from "@/lib/commission-proof";
import { releaseDay, voucherMates } from "@/lib/commission-voucher-set";
import { getCommissionVoucherNoByDeal } from "@/lib/commission-voucher";
import { buildCommissionsFresh, allDeals, canMarkPaid, dealKey, markPaidOpensYMD, MARK_PAID_LEAD_DAYS, commissionToday, type CommissionDealKind, type CommissionPayeeKind } from "@/lib/sales-commission";

const peso = (n: number) => `₱${n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The viewer plus the roles the proof rules read. */
async function commissionViewer() {
  const user = await getCurrentUser();
  if (!user) return null;
  const assignments = await getWorkflowRoles();
  return {
    user,
    id: user.id,
    admin: isAdmin(user),
    workflowRoles: WORKFLOW_ROLE_KEYS.filter((k) => userHasWorkflowRole(assignments, user.id, k as WorkflowRoleKey)),
  };
}

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

/**
 * Attach the proof that a payout was actually sent — the deposit slip or the
 * transfer screenshot.
 *
 * Three seats may do it (Accounting, the Payment Approver, an admin); the payee
 * may only read it. Which rows it lands on is `proofTargets`: the payout that
 * person is in the middle of — released or about to be, and not yet signed for.
 *
 * The file is already in storage by the time this runs (the upload route put it
 * there and checked the same permission). This records where it is.
 */
export async function attachCommissionProof(
  salespersonId: string,
  doc: { path: string; name: string; uploadedAt: string; uploadedById: string; uploadedByName: string },
): Promise<ActionResult & { count?: number }> {
  const viewer = await commissionViewer();
  if (!viewer) return refuse("Please sign in again.");
  if (!canAttachCommissionProof(viewer)) {
    return refuse("Only Accounting, the Payment Approver or an admin can attach proof of payment.");
  }
  // The path carries the payee's id, and it is the path the file actually lives
  // at — so a mismatch here means the form and the upload disagree about whose
  // money this is. Refuse rather than guess.
  if (salespersonIdFromProofPath(doc.path) !== salespersonId) {
    return refuse("That file doesn't belong to this salesperson's payout.");
  }

  const todayYMD = commissionToday();
  const deals = allDeals(await buildCommissionsFresh()).map((d) => ({
    ...d,
    payableNow: canMarkPaid(d, todayYMD),
  }));
  const targets = proofTargets(salespersonId, deals);
  if (targets.length === 0) return refuse("There's no open payout for this salesperson to attach a proof to.");

  const rows = await prisma.commission.findMany({
    where: {
      salespersonId,
      OR: targets.map((d) => (d.kind === "order"
        ? { quotationId: d.refId, kind: d.payeeKind }
        : { counterSaleId: d.refId, kind: d.payeeKind })),
    },
    select: { id: true, paymentProof: true },
  });
  if (rows.length === 0) {
    return refuse("Mark the voucher paid first — the proof attaches to a payout that has a record.");
  }

  let attached = 0;
  for (const r of rows) {
    const next = editProofDocs(coerceProofDocs(r.paymentProof), { op: "add", doc });
    if (!next) continue; // already on this row, or the row is full
    await prisma.commission.update({
      where: { id: r.id },
      data: { paymentProof: next as unknown as Prisma.InputJsonValue },
    });
    attached++;
  }
  if (attached === 0) {
    if (rows.every((r) => coerceProofDocs(r.paymentProof).some((d) => d.path === doc.path))) return { ...done, count: 0 };
    return refuse(`Each payout can carry ${MAX_PROOF_DOCS} files — remove one first.`);
  }

  const person = targets[0]?.salespersonName ?? "a salesperson";
  await logActivity(viewer.user, {
    action: "commission.proof.attached",
    category: "commission",
    summary: `Proof of payment attached for ${person} — ${doc.name} (${attached} ${attached === 1 ? "payout" : "payouts"})`,
    entity: "commission",
    entityId: rows[0].id,
    href: "/commissions",
  });
  revalidatePath("/commissions");
  return { ...done, count: attached };
}

/* ------------------------------------------------------------------ *
 * One attachment, every row of the voucher
 *
 * The owner: *"once file is attached. File will also attach to other rows that
 * is related to the said voucher and can be viewable. Purpose of such is faster
 * attachment of voucher. I attach once and auto attach to other"* — and
 * *"Add an option to delete, replace and edit the attached file."*
 *
 * Two different sets, for two different reasons:
 *
 *  · **Attaching** follows the VOUCHER. One payment, one slip, and
 *    `voucherMates` works out which rows that payment paid.
 *  · **Deleting, replacing and renaming** follow the FILE — every row of that
 *    salesperson carrying it, wherever it came from. A file has one identity: if
 *    a rename reached some copies and not others, the same document would be
 *    filed under two names and there would be no way to tell which was right.
 * ------------------------------------------------------------------ */

/** Everything the two rules below read off a `Commission` row. */
const PROOF_ROW_SELECT = {
  id: true, quotationId: true, counterSaleId: true, kind: true,
  salespersonId: true, salespersonName: true,
  paid: true, paidAt: true, receivedAt: true, paymentProof: true,
} as const;

type ProofRow = {
  id: string; quotationId: string | null; counterSaleId: string | null; kind: string;
  salespersonId: string; salespersonName: string;
  paid: boolean; paidAt: Date | null; receivedAt: Date | null; paymentProof: unknown;
};

/** A row as the voucher rule sees it, with its proofs already read. */
function toVoucherRow(r: ProofRow) {
  return {
    id: r.id,
    salespersonId: r.salespersonId,
    salespersonName: r.salespersonName,
    dealKey: dealKey({
      kind: (r.quotationId ? "order" : "counter") as CommissionDealKind,
      refId: r.quotationId ?? r.counterSaleId ?? "",
      payeeKind: r.kind as CommissionPayeeKind,
    }),
    paid: r.paid,
    paidYMD: releaseDay(r.paidAt),
    receivedAt: r.receivedAt ? r.receivedAt.toISOString() : null,
    docs: coerceProofDocs(r.paymentProof),
  };
}

const dealProofWhere = (kind: CommissionDealKind, refId: string, payeeKind: CommissionPayeeKind) =>
  kind === "order"
    ? { quotationId_kind: { quotationId: refId, kind: payeeKind } }
    : { counterSaleId_kind: { counterSaleId: refId, kind: payeeKind } };

/** Write one edit to every row it applies to; returns how many actually moved. */
async function writeProofEdit(rows: ReturnType<typeof toVoucherRow>[], edit: ProofEdit): Promise<number> {
  let changed = 0;
  for (const r of rows) {
    const next = editProofDocs(r.docs, edit);
    if (!next) continue;
    await prisma.commission.update({
      where: { id: r.id },
      data: { paymentProof: next as unknown as Prisma.InputJsonValue },
    });
    changed++;
  }
  return changed;
}

/**
 * Attach a proof to one commission row — the eye in the Action column — **and to
 * every other row of the same voucher.**
 *
 * The owner: *"Put the proof of payment or signed voucher on the corresponding
 * row or client where the commission is paid"*, and then: *"I attach once and
 * auto attach to other."* The row is still where the slip is CHOSEN, because that
 * is where a person can see the client and the amount they are evidencing. It is
 * no longer where the slip STOPS.
 *
 * Which other rows is `voucherMates` — the printed voucher if there is one, the
 * release that paid them if not. Unlike the payout-level attach, a row the payee
 * has already signed for is fair game: that is the case in the owner's
 * screenshot, rows confirmed at 2:14 PM with no slip on them yet.
 *
 * Still the same three seats, and still only a row that has been paid: there is
 * no `Commission` record before that, and no payment to prove.
 */
export async function attachDealProof(
  kind: CommissionDealKind,
  refId: string,
  payeeKind: CommissionPayeeKind,
  doc: { path: string; name: string; uploadedAt: string; uploadedById: string; uploadedByName: string },
): Promise<ActionResult & { count?: number }> {
  const viewer = await commissionViewer();
  if (!viewer) return refuse("Please sign in again.");
  if (!canAttachCommissionProof(viewer)) {
    return refuse("Only Accounting, the Payment Approver or an admin can attach proof of payment.");
  }

  const target = await prisma.commission.findUnique({
    where: dealProofWhere(kind, refId, payeeKind),
    select: PROOF_ROW_SELECT,
  });
  if (!target) return refuse("Mark this commission paid first — a proof of payment needs a payment.");
  if (!target.paid) return refuse("This commission hasn't been paid yet.");
  // The path carries the payee's id, and it is where the file really is. A
  // mismatch means the upload and the row disagree about whose money this is.
  if (salespersonIdFromProofPath(doc.path) !== target.salespersonId) {
    return refuse("That file doesn't belong to this salesperson's payout.");
  }

  const [all, voucherByDeal] = await Promise.all([
    prisma.commission.findMany({ where: { salespersonId: target.salespersonId, paid: true }, select: PROOF_ROW_SELECT }),
    getCommissionVoucherNoByDeal().catch(() => new Map<string, string>()),
  ]);
  const t = toVoucherRow(target as ProofRow);
  const mates = voucherMates(t, all.map((r) => toVoucherRow(r as ProofRow)), voucherByDeal);

  const attached = await writeProofEdit(mates, { op: "add", doc });
  if (attached === 0) {
    // Nothing moved for one of two reasons, and they are not the same news.
    if (mates.every((m) => m.docs.some((d) => d.path === doc.path))) return { ...done, count: 0 };
    return refuse(`A commission can carry ${MAX_PROOF_DOCS} files — remove one first.`);
  }

  await logActivity(viewer.user, {
    action: "commission.proof.attached",
    category: "commission",
    summary: `Proof of payment attached — ${t.salespersonName} · ${doc.name} (${attached} ${attached === 1 ? "commission" : "commissions"} on the voucher)`,
    entity: "commission",
    entityId: target.id,
    href: `/commissions#commission-${kind}-${refId}-${payeeKind}`,
  });
  revalidatePath("/commissions");
  return { ...done, count: attached };
}

/**
 * Delete, replace or rename an attached file — everywhere it is attached, for
 * this salesperson.
 *
 * One implementation for all three, and for both places a proof is shown (the
 * eye on a row, the list on the payout panel), because all three are the same
 * question: *this document changed — where is it?*
 *
 * The salesperson is taken from the PATH, never from the caller: the file lives
 * under the payee's id, so the set of rows this can touch is fixed by where the
 * file actually is.
 */
async function editProofFile(
  salespersonId: string,
  edit: Exclude<ProofEdit, { op: "add" }>,
): Promise<ActionResult & { count?: number }> {
  const viewer = await commissionViewer();
  if (!viewer) return refuse("Please sign in again.");
  if (!canAttachCommissionProof(viewer)) {
    return refuse("Only Accounting, the Payment Approver or an admin can change proof of payment.");
  }
  if (salespersonIdFromProofPath(edit.path) !== salespersonId) {
    return refuse("That file doesn't belong to this salesperson's payout.");
  }
  if (edit.op === "replace" && salespersonIdFromProofPath(edit.doc.path) !== salespersonId) {
    return refuse("The new file doesn't belong to this salesperson's payout.");
  }
  if (edit.op === "rename" && !cleanProofName(edit.name)) {
    return refuse("Give the file a name.");
  }

  const rows = (await prisma.commission.findMany({ where: { salespersonId }, select: PROOF_ROW_SELECT }))
    .map((r) => toVoucherRow(r as ProofRow))
    .filter((r) => r.docs.some((d) => d.path === edit.path));
  if (rows.length === 0) return refuse("That proof is no longer attached.");

  const changed = await writeProofEdit(rows, edit);
  if (changed === 0) {
    return refuse(edit.op === "rename" ? "That is already the file's name." : "That proof is no longer attached.");
  }

  const what = edit.op === "remove" ? "removed" : edit.op === "replace" ? "replaced" : "renamed";
  await logActivity(viewer.user, {
    action: `commission.proof.${what}`,
    category: "commission",
    summary: `Proof of payment ${what} — ${rows[0].salespersonName} (${changed} ${changed === 1 ? "commission" : "commissions"})`,
    entity: "commission",
    entityId: rows[0].id,
    href: "/commissions",
  });
  revalidatePath("/commissions");
  return { ...done, count: changed };
}

/** Delete an attached file from every commission carrying it. */
export async function removeProofFile(salespersonId: string, path: string) {
  return editProofFile(salespersonId, { op: "remove", path });
}

/** Swap an attached file for a freshly uploaded one, in place, everywhere. */
export async function replaceProofFile(
  salespersonId: string,
  path: string,
  doc: { path: string; name: string; uploadedAt: string; uploadedById: string; uploadedByName: string },
) {
  return editProofFile(salespersonId, { op: "replace", path, doc });
}

/**
 * Rename an attached file — the "edit" of the owner's three.
 *
 * The file itself cannot be edited in a browser, and should not be: it is
 * evidence. What can usefully change is the label it is read by, so
 * `1758000000000-4.pdf` can become `BDO deposit 09-15`.
 */
export async function renameProofFile(salespersonId: string, path: string, name: string) {
  return editProofFile(salespersonId, { op: "rename", path, name });
}
