/**
 * Builds the serialisable row the Cash Requests list renders from a stored
 * CashRequest. Computes the role-stamped trail, the available chain actions
 * (gated by the viewer's role / whether they're the requestor) and the
 * liquidation view + its permission flags.
 */
import {
  CASH_STATUS_LABEL,
  cashStepsFrom,
  cashCategoryLabel,
  coerceCashLines,
  coerceLiquidation,
  isLiquidated,
  liquidationVariance,
  canLiquidateAt,
  isCashCancellable,
  type CashRequestStatus,
  type CashActor,
  type CashRequestLine,
} from "@/lib/cash-request";
import type { ReconcileStatus } from "@/lib/purchase-reconcile";
import { deptLabel, PRODUCTION_DEPTS } from "@/lib/order-workflow";
import { workflowRoleLabel } from "@/lib/workflow-roles";
import { round2 } from "@/lib/quote";
import { formatDateTime } from "@/lib/utils";

export interface CashActionOpt {
  key: string;
  label: string;
  canAct: boolean;
  actorLabel: string; // who must act (role or "the requestor")
}

/** One liquidated line for display: planned vs actual with the difference. */
export interface CashLiquidationLineView {
  description: string;
  budgetAmount: number;
  actualAmount: number;
  variance: number; // budget − actual
}

export interface CashLiquidationView {
  released: number; // released cash (the request amount)
  spent: number | null; // actual spent, or null until liquidated
  variance: number; // released − spent
  status: ReconcileStatus | null; // null until liquidated
  // Seed lines for the record form (the request's breakdown, or one whole-amount line).
  budgetLines: { description: string; budgetAmount: number }[];
  lines: CashLiquidationLineView[] | null; // recorded per-line spend
  receipts: { path: string; name: string }[];
  recorded: string | null; // "Name (Role) · date/time"
  escalated: string | null;
  approved: string | null;
  settled: string | null;
  note: string | null;
}

export interface CashRequestRow {
  id: string;
  number: string;
  purpose: string;
  categoryLabel: string;
  deptLabel: string | null;
  amount: number;
  lines: CashRequestLine[];
  note: string | null;
  status: CashRequestStatus;
  statusLabel: string;
  variant: "secondary" | "warning" | "success" | "destructive";
  trail: string[];
  actions: CashActionOpt[];
  isRequestor: boolean;
  canCancel: boolean;
  liquidation: CashLiquidationView;
  canRecordLiquidation: boolean;
  canSettleLiquidation: boolean;
  canEscalateLiquidation: boolean;
  canApproveLiquidation: boolean;
}

/** The CashRequest fields the builder reads (subset of the Prisma row). */
export interface CashRequestLike {
  id: string;
  number: string;
  purpose: string;
  category: string;
  dept: string | null;
  amount: unknown; // Prisma Decimal
  lines: unknown;
  note: string | null;
  status: string;
  requestedById: string;
  requestedByName: string;
  createdAt: Date;
  voucherByName: string | null;
  voucherAt: Date | null;
  decidedByName: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  releasedByName: string | null;
  releasedAt: Date | null;
  disbursedByName: string | null;
  disbursedAt: Date | null;
  receivedByName: string | null;
  receivedAt: Date | null;
  liquidation: unknown;
}

const toNum = (v: unknown): number => {
  if (typeof v === "number") return v;
  const n = Number(v as never);
  return Number.isFinite(n) ? n : 0;
};

function stampLabel(s: { byName: string; role: string; at: string; note?: string } | undefined): string | null {
  if (!s?.at) return null;
  return `${s.byName}${s.role ? ` (${s.role})` : ""} · ${formatDateTime(new Date(s.at))}${s.note ? ` · ${s.note}` : ""}`;
}

function variant(s: CashRequestStatus): CashRequestRow["variant"] {
  if (s === "SUBMITTED") return "secondary";
  if (s === "REJECTED" || s === "CANCELLED") return "destructive";
  if (s === "SETTLED") return "success";
  return "warning";
}

function buildTrail(pr: CashRequestLike): string[] {
  const l = coerceLiquidation(pr.liquidation);
  const stamp = (label: string, title: string, who?: string | null, at?: Date | null) =>
    who ? `${label} — ${who} (${title}) · ${formatDateTime(at ?? undefined)}` : null;
  const approver = workflowRoleLabel("payment_approver");
  const acct = workflowRoleLabel("accounting");
  const rejected = pr.status === "REJECTED";
  return [
    stamp("Requested", "Requestor", pr.requestedByName, pr.createdAt),
    stamp("Voucher prepared", acct, pr.voucherByName, pr.voucherAt),
    rejected
      ? stamp("Rejected", approver, pr.decidedByName, pr.decidedAt)
      : stamp("Voucher approved & cash released", approver, pr.releasedByName ?? pr.decidedByName, pr.releasedAt ?? pr.decidedAt),
    stamp("Cash handed to requestor", acct, pr.disbursedByName, pr.disbursedAt),
    stamp("Cash received", "Requestor", pr.receivedByName, pr.receivedAt),
    l.recordedAt ? `Liquidated — ${l.recordedByName}${l.recordedRole ? ` (${l.recordedRole})` : ""} · ${formatDateTime(new Date(l.recordedAt))}` : null,
    stampLabel(l.settled) ? `Settled — ${stampLabel(l.settled)}` : null,
  ].filter((s): s is string => s !== null);
}

export function buildCashRequestRow(
  pr: CashRequestLike,
  ctx: {
    admin: boolean;
    viewerId: string;
    hasRole: (role: "accounting" | "payment_approver") => boolean;
    namesForActor: (actor: CashActor) => string[];
  },
): CashRequestRow {
  const status = pr.status as CashRequestStatus;
  const isRequestor = pr.requestedById === ctx.viewerId;
  const amount = toNum(pr.amount);

  const canByActor = (actor: CashActor): boolean => {
    if (ctx.admin) return true;
    if (actor === "requestor") return isRequestor;
    return ctx.hasRole(actor);
  };
  const actorLabel = (actor: CashActor): string => {
    if (actor === "requestor") return `Requestor (${pr.requestedByName})`;
    const names = ctx.namesForActor(actor);
    return `${workflowRoleLabel(actor)}${names.length ? ` (${names.join(", ")})` : ""}`;
  };

  const actions: CashActionOpt[] = cashStepsFrom(status).map((step) => ({
    key: step.key,
    label: step.label,
    canAct: canByActor(step.by),
    actorLabel: actorLabel(step.by),
  }));

  const reqLines = coerceCashLines(pr.lines);
  // Seed lines for the liquidation form: the request's breakdown, or — when the
  // requestor gave no breakdown — a single line for the whole amount.
  const budgetLines = reqLines.length
    ? reqLines.map((l) => ({ description: l.description, budgetAmount: l.amount }))
    : [{ description: pr.purpose, budgetAmount: amount }];

  const l = coerceLiquidation(pr.liquidation);
  const liquidated = isLiquidated(l);
  const v = liquidationVariance(amount, l);
  const liquidation: CashLiquidationView = {
    released: v.released,
    spent: liquidated ? v.spent : null,
    variance: v.variance,
    status: liquidated ? v.status : null,
    budgetLines,
    lines: l.lines && l.lines.length
      ? l.lines.map((ln) => ({ description: ln.description, budgetAmount: ln.budgetAmount, actualAmount: ln.actualAmount, variance: round2(ln.budgetAmount - ln.actualAmount) }))
      : null,
    receipts: (l.receipts ?? []).map((d) => ({ path: d.path, name: d.name })),
    recorded: l.recordedAt ? `${l.recordedByName}${l.recordedRole ? ` (${l.recordedRole})` : ""} · ${formatDateTime(new Date(l.recordedAt))}` : null,
    escalated: stampLabel(l.escalation),
    approved: stampLabel(l.approval),
    settled: stampLabel(l.settled),
    note: l.note ?? null,
  };

  return {
    id: pr.id,
    number: pr.number,
    purpose: pr.purpose,
    categoryLabel: cashCategoryLabel(pr.category),
    deptLabel: pr.dept ? deptLabel(pr.dept as (typeof PRODUCTION_DEPTS)[number]["key"]) : null,
    amount,
    lines: reqLines,
    note: pr.note,
    status,
    statusLabel: CASH_STATUS_LABEL[status],
    variant: variant(status),
    trail: buildTrail(pr),
    actions,
    isRequestor,
    canCancel: (ctx.admin || (isRequestor && status === "SUBMITTED")) && isCashCancellable(status),
    liquidation,
    canRecordLiquidation: canLiquidateAt(status) && (isRequestor || ctx.admin),
    canSettleLiquidation: ctx.admin || ctx.hasRole("accounting"),
    canEscalateLiquidation: ctx.admin || isRequestor || ctx.hasRole("accounting"),
    canApproveLiquidation: ctx.admin || ctx.hasRole("payment_approver"),
  };
}
