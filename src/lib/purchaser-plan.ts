/**
 * The Purchaser Plan — one row per open MRF on a paid order.
 *
 * The owner's sheet, *PURCHASER TABLE updated.xlsx*, tab "Test 1":
 *
 *   Type · Order no · Ordered date · Account holder · MRF no · MRF status ·
 *   Purchase due date · Client due date
 *
 * and their rulings on what each one is:
 *
 *  - **Rows**: one per MRF (their sample lists order 3747A four times, for MRFs
 *    0450–0453), **open MRFs only** — completed and cancelled ones drop off.
 *  - **Ordered date**: the **first payment** — the day the order became a paid
 *    order; a terms client's PO date. That is `saleRecognitionDate`, the date the
 *    system already dates a sale by, so the plan and the commissions agree.
 *  - **Account holder**: the salesperson who prepared the quotation — the same
 *    person commissions credit.
 *  - **MRF status**: the **Purchasing tab name** — Pending / Approved / Budgeted /
 *    Completed / Rejected / Cancelled — of the purchase request raised from it.
 *  - **Purchase due date**: the due date set on that purchase request in
 *    Purchasing ("Add one").
 *  - **Type** and **Client due date**: typed in by people, stored with who and
 *    when (`PurchaserPlanEntry`).
 *
 * Everything here is pure. The read lives in `purchaser-plan-data`, the writes in
 * the page's actions.
 */
import {
  statusBucket,
  isBudgetCommitted,
  isDeptRequisition,
  isPoApproved,
  prMainIndex,
  type PRStatus,
} from "@/lib/purchasing";
import type { MaterialRequestStatus } from "@/lib/order-workflow";

// --- Type --------------------------------------------------------------------

/** The owner's two values, as their sheet spells them. */
export const PLAN_TYPES = [
  { key: "purchase_to_supplier", label: "Purchase to supplier" },
  { key: "for_fabrication", label: "For fabrication" },
] as const;
export type PlanTypeKey = (typeof PLAN_TYPES)[number]["key"];

export const isPlanType = (v: unknown): v is PlanTypeKey => PLAN_TYPES.some((t) => t.key === v);
export const planTypeLabel = (k: string | null | undefined): string => PLAN_TYPES.find((t) => t.key === k)?.label ?? "";

// --- Which MRFs ----------------------------------------------------------------

/** Open = still to be bought, fabricated or released. Finished and called-off MRFs drop off. */
export const isPlanOpenMrf = (status: MaterialRequestStatus | string): boolean =>
  status !== "completed" && status !== "cancelled";

// --- MRF status: the Purchasing tab name ----------------------------------------

/** A purchase request raised from an MRF, as much of it as the plan needs. */
export interface PlanPr {
  status: PRStatus;
  kind?: string | null;
  mrfId?: string | null;
  chainLog?: unknown;
  /** The due date set in Purchasing. */
  purchaseDueAt?: Date | string | null;
}

const TAB_LABEL = {
  pending: "Pending",
  approved: "Approved",
  budgeted: "Budgeted",
  rejected: "Rejected",
  cancelled: "Cancelled",
} as const;

/**
 * The Purchasing tab a request sits in — the same split the workspace makes:
 * `statusBucket` (which keeps a Plant-Manager-approved department MRF in Pending
 * until the Approver clears it), then Approved vs Budgeted at
 * `isBudgetCommitted`. A completed request is shown as **Completed**, the name of
 * the section the workspace moves it to.
 */
export function purchasingTabName(pr: PlanPr): string {
  if (pr.status === "COMPLETED") return "Completed";
  const b = statusBucket(pr.status, { isDept: isDeptRequisition(pr), poApproved: isPoApproved(pr.chainLog) });
  if (b === "approved" && isBudgetCommitted(pr.status)) return TAB_LABEL.budgeted;
  return TAB_LABEL[b];
}

/**
 * The MRF's status for the plan.
 *
 * Usually one purchase request per MRF. A multi-supplier requisition can be
 * SPLIT into siblings that share the MRF, and then the plan reports the one
 * **furthest behind** — a plan is about what is still outstanding, and the
 * least-advanced request is what holds the MRF up. Requests that were rejected
 * or cancelled only speak when nothing live is left.
 *
 * An MRF that never reached Purchasing has no tab. It is described by where it
 * actually is: still waiting on the warehouse, or issued from stock.
 */
export function planMrfStatus(mrfStatus: MaterialRequestStatus | string, prs: readonly PlanPr[]): string {
  const live = prs.filter((p) => p.status !== "REJECTED" && p.status !== "CANCELLED");
  const pool = live.length ? live : prs;
  if (pool.length) {
    const behind = [...pool].sort((a, b) => rank(a.status) - rank(b.status))[0];
    return purchasingTabName(behind);
  }
  switch (mrfStatus) {
    case "requested": return "Requested";
    case "issued": return "Issued from stock";
    case "partial": return "Partly issued";
    case "purchasing": return "Purchasing";
    default: return "—";
  }
}
// Off-chain statuses (rejected / cancelled) sort last.
const rank = (s: PRStatus) => {
  const i = prMainIndex(s);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

// --- Dates ---------------------------------------------------------------------

const MS_PH = 8 * 3600 * 1000;
/** Manila calendar day of an instant — the same day the rest of the app shows. */
export const manilaDay = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t + MS_PH).toISOString().slice(0, 10);
};

/** The earliest due date across the MRF's purchase requests — the one that bites first. */
export function earliestPurchaseDue(prs: readonly PlanPr[]): string | null {
  const days = prs.map((p) => manilaDay(p.purchaseDueAt ?? null)).filter((d): d is string => !!d).sort();
  return days[0] ?? null;
}

/** A Client due date as typed: a real calendar day, or nothing. */
export function normaliseDueDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

// --- The row -------------------------------------------------------------------

export interface PurchaserPlanRow {
  key: string;
  quotationId: string;
  mrfId: string;
  orderNo: string;
  /** Where Order no. leads — the MRF itself. */
  href: string;
  orderedDate: string | null;
  accountHolder: string;
  mrfNo: string;
  mrfStatus: string;
  purchaseDue: string | null;
  type: PlanTypeKey | null;
  typeByName: string | null;
  typeAt: string | null;
  clientDue: string | null;
  clientDueByName: string | null;
  clientDueAt: string | null;
}

/**
 * Default order: **Purchase due date, soonest first** — the owner's sheet has its
 * sort arrow on that column. Rows with no due date yet go last, by order date.
 */
export function sortPlanRows(rows: PurchaserPlanRow[]): PurchaserPlanRow[] {
  return [...rows].sort((a, b) => {
    if (a.purchaseDue && b.purchaseDue && a.purchaseDue !== b.purchaseDue) return a.purchaseDue < b.purchaseDue ? -1 : 1;
    if (!!a.purchaseDue !== !!b.purchaseDue) return a.purchaseDue ? -1 : 1;
    const ao = a.orderedDate ?? "9999", bo = b.orderedDate ?? "9999";
    if (ao !== bo) return ao < bo ? -1 : 1;
    return a.mrfNo.localeCompare(b.mrfNo);
  });
}
