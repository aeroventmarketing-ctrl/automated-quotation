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
  SUBMITTED: "Requested — awaiting voucher",
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

/** The cash-request chain, in order. VOUCHER_READY offers approve or reject. */
export const CASH_STEPS: CashStepDef[] = [
  { key: "voucher", from: "SUBMITTED", to: "VOUCHER_READY", by: "accounting", label: "Prepare voucher" },
  { key: "release", from: "VOUCHER_READY", to: "CASH_RELEASED", by: "payment_approver", label: "Approve voucher & release cash" },
  { key: "reject", from: "VOUCHER_READY", to: "REJECTED", by: "payment_approver", label: "Reject" },
  { key: "disburse", from: "CASH_RELEASED", to: "DISBURSED", by: "accounting", label: "Hand cash to requestor" },
  { key: "confirm", from: "DISBURSED", to: "RECEIVED", by: "requestor", label: "Confirm cash received" },
];

/** The linear main chain, in order (excludes REJECTED / CANCELLED branches). */
export const CASH_MAIN_ORDER: CashRequestStatus[] = [
  "SUBMITTED", "VOUCHER_READY", "CASH_RELEASED", "DISBURSED", "RECEIVED", "LIQUIDATED", "SETTLED",
];
export function cashMainIndex(status: CashRequestStatus): number {
  return CASH_MAIN_ORDER.indexOf(status);
}
/** Earlier statuses an admin may roll a request back to (a rejected/cancelled one reopens to the start). */
export function priorCashStatuses(status: CashRequestStatus): CashRequestStatus[] {
  if (status === "REJECTED" || status === "CANCELLED") return ["SUBMITTED"];
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
  };
}

/** Has the requestor recorded the liquidation (actual spend) yet? */
export function isLiquidated(l: CashLiquidation): boolean {
  return typeof l.actualSpent === "number";
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

/** A cash request can be cancelled up to (but not after) it's settled/received. */
export function isCashCancellable(status: CashRequestStatus): boolean {
  return status !== "SETTLED" && status !== "CANCELLED" && status !== "REJECTED";
}

export { balanceTolerance };
