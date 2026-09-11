/**
 * Cash requests (cash vouchers). AeroVent's standard money-request flow, for
 * cash that isn't a supplier material PO — advances, reimbursements, petty cash
 * and general expenses:
 *
 *   Requestor requests money  → SUBMITTED
 *   Accounting prepares voucher → VOUCHER_READY
 *   Approver approves & releases cash → CASH_RELEASED   (cash goes to accounting)
 *   Accounting hands the cash to the requestor → DISBURSED
 *   Requestor confirms the cash received → RECEIVED
 *   Requestor liquidates (receipts + actual spend) → LIQUIDATED
 *   Change returned / overspend reimbursed → SETTLED
 *
 * The approver may reject the voucher (REJECTED); the requestor/admin may cancel
 * before the voucher is prepared (CANCELLED). Liquidation reuses the voucher
 * reconciliation maths (variance = released − spent, small balance tolerance) so
 * a receipt read by AI can tally automatically.
 */
import type { SaleDoc } from "@/lib/sale";
import { computeVariance, balanceTolerance, type ReconcileStatus } from "@/lib/purchase-reconcile";
import { round2 } from "@/lib/quote";

export type CashRequestStatus =
  | "PENDING_APPROVAL"
  | "SUBMITTED"
  | "REJECTED"
  | "VOUCHER_READY"
  | "CASH_RELEASED"
  | "DISBURSED"
  | "RECEIVED"
  | "LIQUIDATED"
  | "SETTLED"
  | "CANCELLED";

export const CASH_STATUS_LABEL: Record<CashRequestStatus, string> = {
  PENDING_APPROVAL: "Requested — awaiting Accounting approval",
  SUBMITTED: "Approved — awaiting voucher",
  REJECTED: "Rejected",
  VOUCHER_READY: "Voucher ready — awaiting approver",
  CASH_RELEASED: "Cash released — awaiting hand-off to requestor",
  DISBURSED: "Cash handed to requestor — awaiting confirmation",
  RECEIVED: "Cash received — awaiting liquidation",
  LIQUIDATED: "Liquidated — awaiting settlement",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
};

/** Who a chain step is performed by. "requestor" = the person who raised it. */
export type CashActor = "accounting" | "payment_approver" | "requestor";

export interface CashStepDef {
  key: string;
  from: CashRequestStatus;
  to: CashRequestStatus;
  by: CashActor;
  label: string;
}

/** The cash-request chain, in order. Accounting first approves/rejects the
 *  incoming request; VOUCHER_READY then offers the approver approve or reject. */
export const CASH_STEPS: CashStepDef[] = [
  { key: "approve", from: "PENDING_APPROVAL", to: "SUBMITTED", by: "accounting", label: "Approve request" },
  { key: "reject_request", from: "PENDING_APPROVAL", to: "REJECTED", by: "accounting", label: "Reject" },
  { key: "voucher", from: "SUBMITTED", to: "VOUCHER_READY", by: "accounting", label: "Prepare voucher" },
  { key: "release", from: "VOUCHER_READY", to: "CASH_RELEASED", by: "payment_approver", label: "Approve voucher & release cash" },
  { key: "reject", from: "VOUCHER_READY", to: "REJECTED", by: "payment_approver", label: "Reject" },
  { key: "disburse", from: "CASH_RELEASED", to: "DISBURSED", by: "accounting", label: "Hand cash to requestor" },
  { key: "confirm", from: "DISBURSED", to: "RECEIVED", by: "requestor", label: "Confirm cash received" },
];

/** The linear main chain, in order (excludes REJECTED / CANCELLED branches). */
export const CASH_MAIN_ORDER: CashRequestStatus[] = [
  "PENDING_APPROVAL", "SUBMITTED", "VOUCHER_READY", "CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED", "SETTLED",
];
export function cashMainIndex(status: CashRequestStatus): number {
  return CASH_MAIN_ORDER.indexOf(status);
}
/** Earlier statuses an admin may roll a request back to (a rejected/cancelled one reopens to the start). */
export function priorCashStatuses(status: CashRequestStatus): CashRequestStatus[] {
  if (status === "REJECTED" || status === "CANCELLED") return ["PENDING_APPROVAL"];
  const idx = cashMainIndex(status);
  return idx <= 0 ? [] : CASH_MAIN_ORDER.slice(0, idx);
}

export function cashStepsFrom(status: CashRequestStatus): CashStepDef[] {
  return CASH_STEPS.filter((s) => s.from === status);
}
export function cashStep(key: string): CashStepDef | undefined {
  return CASH_STEPS.find((s) => s.key === key);
}

/** Categories of cash request (drives nothing but reporting/labelling). */
export const CASH_CATEGORIES = [
  { key: "advance", label: "Cash advance" },
  { key: "reimbursement", label: "Reimbursement" },
  { key: "expense", label: "Expense / operating" },
  { key: "petty_cash", label: "Petty cash" },
  { key: "other", label: "Other" },
] as const;
export type CashCategoryKey = (typeof CASH_CATEGORIES)[number]["key"];
export function cashCategoryLabel(key: string): string {
  return CASH_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

/** One optional line of the requested breakdown (what the money is for). */
export interface CashRequestLine {
  description: string;
  amount: number;
}

export function coerceCashLines(v: unknown): CashRequestLine[] {
  if (!Array.isArray(v)) return [];
  const out: CashRequestLine[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const description = typeof o.description === "string" ? o.description : "";
    const amount = typeof o.amount === "number" ? o.amount : Number(o.amount) || 0;
    if (description.trim() === "" && amount === 0) continue;
    out.push({ description, amount });
  }
  return out;
}

export interface CashStamp {
  byName: string;
  role: string;
  at: string; // ISO
  note?: string;
}

/** One liquidated line: what was planned for it vs what was actually spent. */
export interface CashLiquidationLine {
  description: string;
  budgetAmount: number; // planned amount (from the request breakdown)
  actualAmount: number; // actual amount spent, per the receipt
}

export function coerceLiquidationLines(v: unknown): CashLiquidationLine[] {
  if (!Array.isArray(v)) return [];
  const out: CashLiquidationLine[] = [];
  for (const e of v) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    out.push({
      description: typeof o.description === "string" ? o.description : "",
      budgetAmount: typeof o.budgetAmount === "number" ? o.budgetAmount : Number(o.budgetAmount) || 0,
      actualAmount: typeof o.actualAmount === "number" ? o.actualAmount : Number(o.actualAmount) || 0,
    });
  }
  return out;
}

/** Liquidation of the released cash — per-line actual spend + receipts, with the
 *  same change/overspend maths as voucher reconciliation. */
export interface CashLiquidation {
  actualSpent?: number; // total actually spent (Σ line actuals)
  lines?: CashLiquidationLine[]; // per-line breakdown of the spend
  receipts?: SaleDoc[];
  recordedByName?: string;
  recordedRole?: string;
  recordedAt?: string; // ISO
  // Whether the actuals were read from the uploaded receipt by the AI (true) or
  // typed by hand (false/undefined). A manual record only proves the typed
  // figures tally against the cash released — NOT that they match the receipt.
  aiVerified?: boolean;
  note?: string;
  aiReadCount?: number; // times the AI receipt reader has been run (limited)
  aiReadEscalation?: CashStamp; // requestor/accounting informed the approver the AI-read limit was hit
  escalation?: CashStamp; // requestor/accounting informed the approver
  approval?: CashStamp; // the approver authorised the discrepancy
  settled?: CashStamp; // change returned / overspend reimbursed
  adminTally?: CashStamp; // an admin corrected the per-line tally (authorised hand-tally)
}

function coerceStamp(v: unknown): CashStamp | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  return {
    byName: typeof o.byName === "string" ? o.byName : "",
    role: typeof o.role === "string" ? o.role : "",
    at: typeof o.at === "string" ? o.at : "",
    note: typeof o.note === "string" ? o.note : undefined,
  };
}
function coerceDoc(v: unknown): SaleDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || typeof o.name !== "string") return null;
  return { path: o.path, name: o.name, uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "" };
}

export function coerceLiquidation(v: unknown): CashLiquidation {
  if (!v || typeof v !== "object") return {};
  const o = v as Record<string, unknown>;
  return {
    actualSpent: typeof o.actualSpent === "number" ? o.actualSpent : undefined,
    lines: Array.isArray(o.lines) ? coerceLiquidationLines(o.lines) : undefined,
    receipts: Array.isArray(o.receipts) ? o.receipts.map(coerceDoc).filter((d): d is SaleDoc => d !== null) : undefined,
    recordedByName: typeof o.recordedByName === "string" ? o.recordedByName : undefined,
    recordedRole: typeof o.recordedRole === "string" ? o.recordedRole : undefined,
    recordedAt: typeof o.recordedAt === "string" ? o.recordedAt : undefined,
    aiVerified: typeof o.aiVerified === "boolean" ? o.aiVerified : undefined,
    note: typeof o.note === "string" ? o.note : undefined,
    aiReadCount: typeof o.aiReadCount === "number" ? o.aiReadCount : undefined,
    aiReadEscalation: coerceStamp(o.aiReadEscalation),
    escalation: coerceStamp(o.escalation),
    approval: coerceStamp(o.approval),
    settled: coerceStamp(o.settled),
    adminTally: coerceStamp(o.adminTally),
  };
}

/** Has the requestor recorded the liquidation (actual spend) yet? */
export function isLiquidated(l: CashLiquidation): boolean {
  return typeof l.actualSpent === "number";
}

/**
 * The amount a released cash voucher books as an expense in the P&L: once the
 * cash has been liquidated, the *actual* spend (Σ line actuals) — so change
 * returned / overspend, and any admin per-line correction, flow through — and
 * otherwise the released (requested) amount. The released figure itself is left
 * untouched (it stays the tally denominator on the liquidation).
 */
export function cashExpenseBooked(releasedAmount: number, liquidation: unknown): number {
  const l = coerceLiquidation(liquidation);
  return isLiquidated(l) ? round2(l.actualSpent ?? 0) : round2(releasedAmount);
}

/** Released vs actual spend → variance (released − spent) and its status. */
export function liquidationVariance(released: number, l: CashLiquidation): { released: number; spent: number; variance: number; status: ReconcileStatus } {
  const spent = round2(l.actualSpent ?? 0);
  const { variance, status } = computeVariance(round2(released), spent);
  return { released: round2(released), spent, variance, status };
}

/** A cash request can be liquidated once the requestor has the cash. */
export function canLiquidateAt(status: CashRequestStatus): boolean {
  return status === "RECEIVED" || status === "LIQUIDATED";
}

/**
 * Which tab of the Cash Requests workspace a request sits in.
 *
 * Defined HERE, beside the rules below, and imported by the list — because the
 * owner's instructions are phrased as tabs (*"in Cash Requests Approved Tab…"*,
 * *"In cash requests Budgeted Tab…"*) and a rule that disagrees with the tab it
 * names is a rule in the wrong place. One definition, so they cannot drift.
 */
export type CashBucket = "pending" | "approved" | "budgeted" | "rejected" | "cancelled" | "completed";

export function cashBucket(status: CashRequestStatus): CashBucket {
  switch (status) {
    case "PENDING_APPROVAL":
      return "pending";
    case "SUBMITTED":
    case "VOUCHER_READY":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "CANCELLED":
      return "cancelled";
    case "SETTLED":
      // Finished: liquidated and settled, nothing left to do. It leaves the tabs
      // entirely for the collapsed "Completed cash vouchers" section — the owner's
      // *"settled Cash Voucher should have a completed Cash Voucher Table same as
      // Purchasing Tab Completed Department POs"*, and the same shape the
      // Requisitions and Purchasing pages already use for a finished row.
      return "completed";
    default:
      // CASH_RELEASED, DISBURSED, RECEIVED, LIQUIDATED — the cash is out and the
      // request is still in flight.
      return "budgeted";
  }
}

/** A finished voucher: out of the tabs, into the collapsed section at the foot. */
export function isCompletedCashRequest(status: CashRequestStatus): boolean {
  return cashBucket(status) === "completed";
}

/** Who is asking. `requestor` is the person who raised this particular request. */
export interface CashRequestActor {
  admin?: boolean;
  accounting?: boolean;
  paymentApprover?: boolean;
  requestor?: boolean;
}

/**
 * Who may CANCEL a cash request.
 *
 * | | where |
 * | --- | --- |
 * | admin | anywhere still cancellable |
 * | the requestor | before the voucher exists — PENDING_APPROVAL, SUBMITTED |
 * | **Accounting** | the **Approved** tab — *"add an option to cancel for accounting role"* |
 * | **Payment Approver** | the **Budgeted** tab — the cash is out and they signed for it |
 *
 * Everything still runs through `isCashCancellable`, which stops at SETTLED: a
 * settled request has been liquidated and reconciled, and withdrawing it would
 * unpick a closed set of books rather than call off a payment. Reopening one is
 * what the admin rollback is for.
 */
export function canCancelCashRequest(status: CashRequestStatus, actor: CashRequestActor): boolean {
  if (!isCashCancellable(status)) return false;
  if (actor.admin) return true;
  if (actor.requestor && (status === "PENDING_APPROVAL" || status === "SUBMITTED")) return true;
  const bucket = cashBucket(status);
  if (actor.accounting && bucket === "approved") return true;
  if (actor.paymentApprover && bucket === "budgeted") return true;
  return false;
}

/**
 * Who may REJECT a cash request **after the cash has gone out** — *"In cash
 * requests Budgeted Tab, add an option to cancel and reject for admin/payment
 * approver role."*
 *
 * Deliberately separate from the `reject` CHAIN STEP, which already exists at
 * VOUCHER_READY and is the ordinary "no, don't pay this". This one is the
 * exception: the voucher was approved, the cash was released, and somebody with
 * standing has to unwind it. It carries a reason for that reason.
 *
 * Same stop at SETTLED as cancelling, and for the same reason.
 */
export function canRejectCashRequest(status: CashRequestStatus, actor: CashRequestActor): boolean {
  if (!isCashCancellable(status)) return false; // SETTLED / already closed
  if (cashBucket(status) !== "budgeted") return false;
  return !!actor.admin || !!actor.paymentApprover;
}

/** A cash request can be cancelled up to (but not after) it's settled/received. */
export function isCashCancellable(status: CashRequestStatus): boolean {
  return status !== "SETTLED" && status !== "CANCELLED" && status !== "REJECTED";
}

export { balanceTolerance };
