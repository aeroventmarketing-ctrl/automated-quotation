"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getWorkflowRoles, userHasWorkflowRole, workflowRoleLabel, type WorkflowRoleKey } from "@/lib/workflow-roles";
import {
  cashStep,
  coerceLiquidation,
  isLiquidated,
  canLiquidateAt,
  isCashCancellable,
  CASH_CATEGORIES,
  CASH_MAIN_ORDER,
  cashMainIndex,
  priorCashStatuses,
  type CashRequestStatus,
  type CashCategoryKey,
} from "@/lib/cash-request";
import { PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { round2 } from "@/lib/quote";

/** Claim the next cash-voucher number, e.g. "CV-2026-00042". */
async function nextCashNumber(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const KEY = "cash_request_counter";
  const row = await tx.appSetting.findUnique({ where: { key: KEY } });
  const cur = typeof (row?.value as { n?: unknown } | null)?.n === "number" ? (row!.value as { n: number }).n : 0;
  const n = cur + 1;
  await tx.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: { n } as Prisma.InputJsonValue },
    update: { value: { n } as Prisma.InputJsonValue },
  });
  return `CV-${year}-${String(n).padStart(5, "0")}`;
}

const num = (s: unknown): number => {
  const n = Number(String(s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * Raise a cash request. Any authenticated staff member can request money; it
 * enters the chain at SUBMITTED for accounting to prepare the voucher. `amount`
 * defaults to the sum of the line breakdown when left blank.
 */
export async function createCashRequest(input: {
  purpose: string;
  category: string;
  dept?: string | null;
  amount?: string;
  lines?: { description: string; amount: string }[];
  note?: string;
}): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");

  const purpose = (input.purpose ?? "").trim();
  if (!purpose) throw new Error("Describe what the cash is for.");
  const category: CashCategoryKey = (CASH_CATEGORIES.find((c) => c.key === input.category)?.key ?? "advance") as CashCategoryKey;
  const dept = input.dept && PRODUCTION_DEPTS.some((d) => d.key === input.dept) ? input.dept : null;

  const lines = (input.lines ?? [])
    .map((l) => ({ description: String(l.description ?? "").trim(), amount: num(l.amount) }))
    .filter((l) => l.description !== "" || l.amount !== 0);
  const linesTotal = lines.reduce((a, l) => a + l.amount, 0);
  const amount = input.amount && input.amount.trim() !== "" ? num(input.amount) : linesTotal;
  if (amount <= 0) throw new Error("Enter the amount being requested (greater than zero).");

  const year = new Date().getFullYear();
  await prisma.$transaction(async (tx) => {
    const number = await nextCashNumber(tx, year);
    await tx.cashRequest.create({
      data: {
        number,
        purpose,
        category,
        dept,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        lines: lines as unknown as Prisma.InputJsonValue,
        status: "SUBMITTED",
        requestedById: user.id,
        requestedByName: user.name,
        note: input.note?.trim() || null,
      },
    });
  });
  revalidatePath("/cash-requests");
}

async function loadOr404(id: string) {
  const pr = await prisma.cashRequest.findUnique({ where: { id } });
  if (!pr) throw new Error("Cash request not found");
  return pr;
}

/**
 * Advance a cash request one step along the chain: voucher (accounting) →
 * approve & release / reject (approver) → hand to requestor (accounting) →
 * confirm (requestor). Each step is gated by who may perform it.
 */
export async function advanceCashRequest(id: string, stepKey: string, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const step = cashStep(stepKey);
  if (!step) throw new Error("Unknown step");

  const pr = await loadOr404(id);
  if (pr.status !== step.from) throw new Error("That step isn't available at the current status.");

  const admin = isAdmin(user);
  // Gate by who performs the step.
  if (!admin) {
    if (step.by === "requestor") {
      if (pr.requestedById !== user.id) throw new Error("Only the requestor can confirm they received the cash.");
    } else {
      const ok = userHasWorkflowRole(await getWorkflowRoles(), user.id, step.by as WorkflowRoleKey);
      if (!ok) throw new Error(`Only ${workflowRoleLabel(step.by)} or an admin can do this.`);
    }
  }

  const now = new Date();
  const data: Prisma.CashRequestUpdateInput = { status: step.to };
  switch (stepKey) {
    case "voucher":
      data.voucherByName = user.name;
      data.voucherAt = now;
      if (note) data.voucherRef = note;
      break;
    case "release":
      data.decidedByName = user.name;
      data.decidedAt = now;
      data.releasedByName = user.name;
      data.releasedAt = now;
      if (note) data.decisionNote = note;
      break;
    case "reject":
      data.decidedByName = user.name;
      data.decidedAt = now;
      if (note) data.decisionNote = note;
      break;
    case "disburse":
      data.disbursedByName = user.name;
      data.disbursedAt = now;
      break;
    case "confirm":
      data.receivedByName = user.name;
      data.receivedAt = now;
      break;
  }
  await prisma.cashRequest.update({ where: { id }, data });
  revalidatePath("/cash-requests");
}

/** Cancel a cash request (requestor before the voucher, or an admin any time up to settlement). */
export async function cancelCashRequest(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const pr = await loadOr404(id);
  if (!isCashCancellable(pr.status as CashRequestStatus)) throw new Error("This cash request can no longer be cancelled.");
  if (!(admin || (pr.requestedById === user.id && pr.status === "SUBMITTED"))) {
    throw new Error("Only the requestor (before the voucher is prepared) or an admin can cancel this.");
  }
  await prisma.cashRequest.update({ where: { id }, data: { status: "CANCELLED" } });
  revalidatePath("/cash-requests");
}

// --- Liquidation ------------------------------------------------------------

/** Which finance role the actor is acting in (for the stamp), if any. */
async function financeRole(userId: string, roles: WorkflowRoleKey[]): Promise<WorkflowRoleKey | undefined> {
  const assignments = await getWorkflowRoles();
  return roles.find((r) => userHasWorkflowRole(assignments, userId, r));
}

/**
 * Record the liquidation of the released cash — the actual amount spent, an
 * optional per-line breakdown, and the receipts (uploaded to /api/cash-uploads).
 * The system tallies it against the released amount (change / overspend). Done
 * by the requestor (or an admin).
 */
export async function recordCashLiquidation(
  id: string,
  input: {
    lines: { description: string; budgetAmount: number; actualAmount: string }[];
    receipts?: { path: string; name: string; uploadedAt?: string }[];
    note?: string;
  },
): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const pr = await loadOr404(id);
  if (!(admin || pr.requestedById === user.id)) throw new Error("Only the requestor or an admin can liquidate this cash.");
  if (!canLiquidateAt(pr.status as CashRequestStatus)) throw new Error("Liquidate once the cash has been received.");

  // Per-line actuals: each line carries the planned (budget) amount and the
  // actual amount spent; the total spent is the sum of the line actuals.
  const lines = (input.lines ?? []).map((l) => ({
    description: String(l.description ?? ""),
    budgetAmount: Number(l.budgetAmount) || 0,
    actualAmount: num(l.actualAmount),
  }));
  if (lines.length === 0) throw new Error("Nothing to liquidate — add at least one line.");
  const actualSpent = round2(lines.reduce((a, l) => a + l.actualAmount, 0));
  const receipts = (input.receipts ?? [])
    .filter((d) => d && typeof d.path === "string" && typeof d.name === "string")
    .map((d) => ({ path: d.path, name: d.name, uploadedAt: d.uploadedAt ?? new Date().toISOString() }));

  const cur = coerceLiquidation(pr.liquidation);
  const next = {
    ...cur,
    actualSpent,
    lines,
    receipts: receipts.length ? receipts : cur.receipts,
    recordedByName: user.name,
    recordedRole: pr.requestedById === user.id ? "Requestor" : "Admin",
    recordedAt: new Date().toISOString(),
    note: input.note?.trim() || undefined,
  };
  await prisma.cashRequest.update({
    where: { id },
    data: { status: "LIQUIDATED", liquidation: next as unknown as Prisma.InputJsonValue },
  });
  revalidatePath("/cash-requests");
}

/** Requestor/accounting escalate a liquidation discrepancy to the approver. */
export async function escalateCashLiquidation(id: string, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const pr = await loadOr404(id);
  const acct = await financeRole(user.id, ["accounting"]);
  if (!(admin || pr.requestedById === user.id || acct)) throw new Error("Only the requestor, Accounting or an admin can escalate a discrepancy.");
  const cur = coerceLiquidation(pr.liquidation);
  if (!isLiquidated(cur)) throw new Error("Record the actual spend first.");
  const role = acct ? workflowRoleLabel("accounting") : pr.requestedById === user.id ? "Requestor" : "Admin";
  const next = { ...cur, escalation: { byName: user.name, role, at: new Date().toISOString(), note: note?.trim() || undefined } };
  await prisma.cashRequest.update({ where: { id }, data: { liquidation: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/cash-requests");
}

/** The approver authorises a liquidation discrepancy (approve or edit-then-approve). */
export async function approveCashLiquidation(id: string, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const isApprover = userHasWorkflowRole(await getWorkflowRoles(), user.id, "payment_approver");
  if (!(admin || isApprover)) throw new Error("Only the Payment Approver or an admin can approve a discrepancy.");
  const pr = await loadOr404(id);
  const cur = coerceLiquidation(pr.liquidation);
  if (!isLiquidated(cur)) throw new Error("Record the actual spend first.");
  const role = isApprover ? workflowRoleLabel("payment_approver") : "Admin";
  const next = { ...cur, approval: { byName: user.name, role, at: new Date().toISOString(), note: note?.trim() || undefined } };
  await prisma.cashRequest.update({ where: { id }, data: { liquidation: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/cash-requests");
}

/**
 * When the AI receipt-read limit is reached, the requestor/accounting informs
 * the admin/approver so they can allow more reads (or the figures go in by hand).
 */
export async function escalateCashAiRead(id: string, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const pr = await loadOr404(id);
  const acct = await financeRole(user.id, ["accounting"]);
  if (!(admin || pr.requestedById === user.id || acct)) throw new Error("Only the requestor, Accounting or an admin can do this.");
  const cur = coerceLiquidation(pr.liquidation);
  const role = acct ? workflowRoleLabel("accounting") : pr.requestedById === user.id ? "Requestor" : "Admin";
  const next = { ...cur, aiReadEscalation: { byName: user.name, role, at: new Date().toISOString(), note: note?.trim() || undefined } };
  await prisma.cashRequest.update({ where: { id }, data: { liquidation: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/cash-requests");
}

/**
 * The admin/approver bypasses the AI receipt-read limit — resets the count so
 * another set of AI reads is allowed (and clears the escalation notice).
 */
export async function resetCashAiRead(id: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const isApprover = userHasWorkflowRole(await getWorkflowRoles(), user.id, "payment_approver");
  if (!(admin || isApprover)) throw new Error("Only the Payment Approver or an admin can bypass the AI-read limit.");
  const pr = await loadOr404(id);
  const cur = coerceLiquidation(pr.liquidation);
  const next = { ...cur, aiReadCount: 0, aiReadEscalation: undefined };
  await prisma.cashRequest.update({ where: { id }, data: { liquidation: next as unknown as Prisma.InputJsonValue } });
  revalidatePath("/cash-requests");
}

/**
 * Admin-only override: roll a cash request back to an earlier stage. Sign-offs
 * recorded after the target stage are cleared (and the liquidation is reset when
 * rolling back before it), so the chain can be walked forward again.
 */
export async function adminRollbackCashRequest(id: string, toStatus: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) throw new Error("Only an admin can roll back the workflow.");
  const target = toStatus as CashRequestStatus;
  if (!CASH_MAIN_ORDER.includes(target)) throw new Error("Choose a valid earlier stage.");
  const pr = await loadOr404(id);
  if (!priorCashStatuses(pr.status as CashRequestStatus).includes(target)) {
    throw new Error("Choose an earlier stage to roll back to.");
  }
  const tgtIdx = cashMainIndex(target);

  const data: Prisma.CashRequestUpdateInput = { status: target };
  if (tgtIdx < cashMainIndex("VOUCHER_READY")) { data.voucherByName = null; data.voucherAt = null; data.voucherRef = null; }
  if (tgtIdx < cashMainIndex("CASH_RELEASED")) { data.decidedByName = null; data.decidedAt = null; data.decisionNote = null; data.releasedByName = null; data.releasedAt = null; }
  if (tgtIdx < cashMainIndex("DISBURSED")) { data.disbursedByName = null; data.disbursedAt = null; }
  if (tgtIdx < cashMainIndex("RECEIVED")) { data.receivedByName = null; data.receivedAt = null; }
  if (tgtIdx < cashMainIndex("LIQUIDATED")) {
    data.liquidation = {} as Prisma.InputJsonValue; // un-liquidate (also clears the settled stamp)
  } else if (tgtIdx < cashMainIndex("SETTLED")) {
    // Rolling back to LIQUIDATED: keep the liquidation record, drop the settled stamp.
    const cur = coerceLiquidation(pr.liquidation);
    data.liquidation = { ...cur, settled: undefined } as unknown as Prisma.InputJsonValue;
  }
  await prisma.cashRequest.update({ where: { id }, data });
  revalidatePath("/cash-requests");
}

/** Settle the liquidation — change returned / overspend reimbursed → SETTLED. */
export async function settleCashLiquidation(id: string, note?: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Unauthorized");
  const admin = isAdmin(user);
  const acct = await financeRole(user.id, ["accounting"]);
  if (!(admin || acct)) throw new Error("Only Accounting or an admin can settle a cash request.");
  const pr = await loadOr404(id);
  const cur = coerceLiquidation(pr.liquidation);
  if (!isLiquidated(cur)) throw new Error("Record the actual spend first.");
  const role = acct ? workflowRoleLabel("accounting") : "Admin";
  const next = { ...cur, settled: { byName: user.name, role, at: new Date().toISOString(), note: note?.trim() || undefined } };
  await prisma.cashRequest.update({
    where: { id },
    data: { status: "SETTLED", liquidation: next as unknown as Prisma.InputJsonValue },
  });
  revalidatePath("/cash-requests");
}
