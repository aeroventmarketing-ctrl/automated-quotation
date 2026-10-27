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
import type { OrderClientDue } from "@/lib/order-client-due";

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
  /** Who rejected / cancelled it, when, and (for a rejection) why. */
  decidedByName?: string | null;
  decidedAt?: Date | string | null;
  decisionNote?: string | null;
  /**
   * Stamped when the Warehouseman presses **Receive & Add Stock** — the step
   * that completes the request. (An Office requisition linked to an order skips
   * warehouse receiving — its goods go straight to the client — and is stamped
   * when it is checked instead, which is also when it completes.)
   */
  receivedAt?: Date | string | null;
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
    // A purchase that is Completed has been received into stock — but the MRF it
    // serves is still open, or it wouldn't be on the plan. Saying "Completed"
    // here read as if the MRF were done (the owner: "how do we know … that the
    // MRF is completed?"). Name where it actually is instead.
    if (behind.status === "COMPLETED") return afterReceipt(mrfStatus);
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
/**
 * The MRF's own stage once its purchase is in stock. An MRF is only COMPLETED
 * when the requesting department presses "Request Received" with every item
 * released — so between the goods arriving and that press there are three
 * honest states:
 *
 *   purchasing → Received in stock · awaiting release   (Warehouse to release)
 *   partial    → Partly released                         (more to release)
 *   issued     → Released · awaiting confirmation        (department to confirm)
 */
export const RECEIVED_AWAITING_RELEASE = "Received in stock · awaiting release";
export const PARTLY_RELEASED = "Partly released";
export const RELEASED_AWAITING_CONFIRMATION = "Released · awaiting confirmation";
function afterReceipt(mrfStatus: MaterialRequestStatus | string): string {
  if (mrfStatus === "issued") return RELEASED_AWAITING_CONFIRMATION;
  if (mrfStatus === "partial") return PARTLY_RELEASED;
  return RECEIVED_AWAITING_RELEASE;
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

/**
 * The Manila day the MRF's purchase was **received into stock** — or null
 * until every live request has been.
 *
 * The owner chose the reference: *"Better reference for this is when
 * warehouseman press the button Receive & Add to stock."* That is the moment
 * the purchase actually lands where the requesting department can be served
 * from, so it is what the due date is judged against — not "Item Bought", which
 * is what I had first used from the schema's wording.
 *
 * Only a request that is COMPLETED counts, so a receipt that was rolled back
 * (the rollback clears `receivedAt`, and the status) never counts. A split MRF
 * is received when its LAST live request is, so that is the date returned.
 */
export function receivedOn(prs: readonly PlanPr[]): string | null {
  const live = prs.filter((p) => p.status !== "REJECTED" && p.status !== "CANCELLED");
  if (live.length === 0) return null;
  if (live.some((p) => p.status !== "COMPLETED")) return null;
  const days = live.map((p) => manilaDay(p.receivedAt ?? null));
  if (days.some((d) => !d)) return null;
  return (days as string[]).sort().at(-1)!;
}

/** A Client due date as typed: a real calendar day, or nothing. */
export function normaliseDueDate(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

// --- PO numbers ------------------------------------------------------------------

/** A Purchase Order to the supplier raised from this MRF. `prId` opens it. */
export interface PlanPo {
  number: string;
  prId: string;
}

export interface PlanPoSource {
  prId: string;
  status: string;
  poNumber: string | null;
  /** When the PO was prepared (ISO), for ordering. */
  poAt: string | null;
}

/**
 * The owner: *"add a column named PO Number … the Purchase Order Number to
 * supplier related to MRF number"*. Every PO raised from the MRF, oldest first,
 * each number once — the members of a combined PO all carry the same number.
 * A rejected or cancelled request's PO is void, so it is left off the plan's
 * rows (`includeClosed` keeps it for the Rejected / Cancelled box, where every
 * request is one of those).
 */
export function planPoNumbers(sources: readonly PlanPoSource[], opts: { includeClosed?: boolean } = {}): PlanPo[] {
  const live = sources.filter((s) => s.poNumber && (opts.includeClosed || !isOffChain(s.status)));
  const sorted = [...live].sort((a, b) => (a.poAt ?? "").localeCompare(b.poAt ?? "") || a.poNumber!.localeCompare(b.poNumber!, undefined, { numeric: true }));
  const out: PlanPo[] = [];
  for (const s of sorted) if (!out.some((p) => p.number === s.poNumber)) out.push({ number: s.poNumber!, prId: s.prId });
  return out;
}

// --- The row -------------------------------------------------------------------

export interface PurchaserPlanRow {
  key: string;
  quotationId: string;
  mrfId: string;
  orderNo: string;
  /** Order no. → the order's workflow page. */
  orderHref: string;
  /** MRF no. → that MRF's card in the order's Phase 3 · Materials (`/orders/{id}#mrf-{mrfId}`). */
  mrfHref: string;
  orderedDate: string | null;
  accountHolder: string;
  /** Every PO to the supplier raised from this MRF, oldest first — see `planPoNumbers`. */
  poNumbers: PlanPo[];
  mrfNo: string;
  mrfStatus: string;
  purchaseDue: string | null;
  /** When the purchase was received into stock (all of it), or null until then. */
  receivedOn: string | null;
  type: PlanTypeKey | null;
  typeByName: string | null;
  typeAt: string | null;
  /**
   * The ORDER's client due date (set in the order's Phase 1 box — the only place
   * it is edited), the same on every MRF row of the order. See `planClientDue`.
   */
  clientDue: string | null;
  clientDueByName: string | null;
  clientDueAt: string | null;
  /**
   * False only for a date typed into the Purchase Plan before the client due
   * date moved to the order — still shown, until the order gets its own.
   */
  clientDueFromOrder: boolean;
  /** Every change ever made to this row, newest first — see `PlanEdit`. */
  edits: PlanEdit[];
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

// --- The client due date comes from the order -----------------------------------

/**
 * The owner: *"wire Client Due date in order workflow to purchase plan … Gray out
 * the client due date in purchase plan, Editing client due date will be
 * available only in order workflow. Do not remove the history link in purchase
 * plan."*
 *
 * Once an order has a client due date record of its own (a date, or a history
 * — cleared counts), it is the source for every MRF row of that order, and its
 * history heads the row's trail. Changes made on the plan before the move stay
 * in the trail beneath it — nothing anybody did is dropped. An order with no
 * record yet falls back to whatever was typed on the plan for that MRF, flagged
 * `fromOrder: false`, so no date silently disappears the day this ships.
 */
export function planClientDue(
  order: OrderClientDue | null,
  legacy: { date: string | null; byName: string | null; at: string | null } | null,
  legacyEdits: PlanEdit[],
): { clientDue: string | null; clientDueByName: string | null; clientDueAt: string | null; clientDueFromOrder: boolean; edits: PlanEdit[] } {
  const older = legacyEdits.filter((e) => e.field === "clientDue");
  if (order) {
    const fromOrder: PlanEdit[] = order.history.map((h) => ({ field: "clientDue", from: h.from, to: h.to, byName: h.byName, at: h.at }));
    return {
      clientDue: order.date,
      clientDueByName: order.date ? order.byName || null : null,
      clientDueAt: order.date ? order.at || null : null,
      clientDueFromOrder: true,
      edits: [...fromOrder, ...older].sort((a, b) => b.at.localeCompare(a.at)),
    };
  }
  return {
    clientDue: legacy?.date ?? null,
    clientDueByName: legacy?.byName ?? null,
    clientDueAt: legacy?.at ?? null,
    clientDueFromOrder: false,
    edits: older,
  };
}

// --- The edit trail ------------------------------------------------------------

/**
 * One change to a plan row, as recorded in `PurchaserPlanEdit` — the owner:
 * *"Record every person who made the edit for tracking purposes."* The "last
 * edited by" stamp answers who touched it most recently; this answers everyone
 * who ever did, and what each of them changed.
 */
export type PlanEditField = "type" | "clientDue";
export interface PlanEdit {
  field: PlanEditField;
  /** As stored: a type key or a YYYY-MM-DD; "" for blank. */
  from: string;
  to: string;
  byName: string;
  at: string;
}

export const PLAN_EDIT_FIELD_LABEL: Record<PlanEditField, string> = { type: "Type", clientDue: "Client due date" };

/** A stored value as a person reads it: the type's label, a spelled-out date, or "—". */
export function planEditValue(field: PlanEditField, v: string): string {
  if (!v) return "—";
  if (field === "type") return planTypeLabel(v) || v;
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return v;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-PH", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** "— → For fabrication", "Oct 24, 2026 → Oct 30, 2026". */
export const planEditChange = (e: Pick<PlanEdit, "field" | "from" | "to">): string =>
  `${planEditValue(e.field, e.from)} → ${planEditValue(e.field, e.to)}`;

// --- Purchase due date: the colour ----------------------------------------------

/**
 * The owner: *"Add color indicator in Purchase Due Date Column — Yellow: 7 days
 * before purchase due date · Amber: 3 days before · Red: overdue · Green: on
 * time."*
 *
 * Counted in whole Manila calendar days between today and the due date:
 *
 *   past the due date          → overdue  (red)
 *   due today … 3 days away    → due3     (amber)  — today is not late yet
 *   4 … 7 days away            → due7     (yellow)
 *   more than 7 days away      → ontime   (green)
 *   no due date set            → null     (no colour)
 *
 * Calendar days, not 24-hour spans, so a date due "tomorrow" is 1 day away all
 * day long, and the colour changes at midnight Manila — the same day boundary
 * every other date on the screen uses.
 */
export type DueTone = "overdue" | "due3" | "due7" | "ontime";

const dayNumber = (ymd: string): number => {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Whole days from today to the due date: 0 = due today, negative = overdue. */
export const daysUntil = (dueYMD: string, todayYMD: string): number => dayNumber(dueYMD) - dayNumber(todayYMD);

export function purchaseDueTone(dueYMD: string | null, todayYMD: string): DueTone | null {
  if (!dueYMD) return null;
  const n = daysUntil(dueYMD, todayYMD);
  if (n < 0) return "overdue";
  if (n <= 3) return "due3";
  if (n <= 7) return "due7";
  return "ontime";
}

/**
 * Once the purchase is RECEIVED INTO STOCK, the countdown no longer applies:
 * there is nothing left to do by the due date. The owner saw "Overdue by 33
 * days" in red on items already in stock — a false alarm. Instead the cell says
 * how it went: received on or before the due date → on time (green); after it →
 * late (a neutral grey, with the days said in words). Grey rather than red: red
 * means "act now", and there is nothing left to act on.
 *
 * Until the Warehouse receives it, the countdown runs on — a purchase that has
 * been bought but not yet received is still owed, and still goes red.
 */
export type DoneTone = "ontime" | "late";
export function purchaseDoneTone(dueYMD: string | null, receivedYMD: string): DoneTone {
  if (!dueYMD) return "ontime";
  return daysUntil(dueYMD, receivedYMD) < 0 ? "late" : "ontime";
}
/** "on time", "2 days late" — the line under "Received Sep 8". */
export function doneSummary(dueYMD: string | null, receivedYMD: string): string {
  const late = dueYMD ? -daysUntil(dueYMD, receivedYMD) : 0;
  return late > 0 ? `${late} day${late === 1 ? "" : "s"} late` : "on time";
}

export const DUE_TONE_LABEL: Record<DueTone, string> = {
  overdue: "Overdue",
  due3: "Due within 3 days",
  due7: "Due within 7 days",
  ontime: "On time",
};

/** "Overdue by 2 days", "Due today", "Due in 5 days". */
export function dueCountdown(dueYMD: string, todayYMD: string): string {
  const n = daysUntil(dueYMD, todayYMD);
  if (n < 0) return `Overdue by ${-n} day${n === -1 ? "" : "s"}`;
  if (n === 0) return "Due today";
  return `Due in ${n} day${n === 1 ? "" : "s"}`;
}

// --- Sort and group ---------------------------------------------------------------

/**
 * The owner: *"Add an option to sort, group and arrange ascending and
 * descending by date, order number, account holder, status, type, purchase due
 * date and client due date."*
 */
export type PlanSortKey = "orderedDate" | "orderNo" | "accountHolder" | "poNumber" | "mrfStatus" | "type" | "purchaseDue" | "clientDue" | "mrfNo";
export type PlanGroupKey = "none" | Exclude<PlanSortKey, "mrfNo">;
export type SortDir = "asc" | "desc";

export const PLAN_SORT_OPTIONS: { key: PlanSortKey; label: string }[] = [
  { key: "purchaseDue", label: "Purchase due date" },
  { key: "clientDue", label: "Client due date" },
  { key: "orderedDate", label: "Ordered date" },
  { key: "orderNo", label: "Order no." },
  { key: "accountHolder", label: "Account holder" },
  { key: "poNumber", label: "PO number" },
  { key: "mrfStatus", label: "MRF status" },
  { key: "type", label: "Type" },
];

export const PLAN_GROUP_OPTIONS: { key: PlanGroupKey; label: string }[] = [
  { key: "none", label: "No grouping" },
  { key: "purchaseDue", label: "Purchase due date" },
  { key: "clientDue", label: "Client due date" },
  { key: "orderedDate", label: "Ordered date" },
  { key: "orderNo", label: "Order no." },
  { key: "accountHolder", label: "Account holder" },
  { key: "poNumber", label: "PO number" },
  { key: "mrfStatus", label: "MRF status" },
  { key: "type", label: "Type" },
];

/**
 * Statuses in the order an MRF actually moves through them, so "ascending"
 * means earliest stage first — not alphabetical, where Approved would come
 * before Requested.
 */
const STATUS_ORDER = [
  "Requested", "Issued from stock", "Partly issued", "Purchasing", "Pending", "Approved", "Budgeted",
  "Received in stock · awaiting release", "Partly released", "Released · awaiting confirmation",
  "Completed", "Rejected", "Cancelled",
];
const statusRank = (s: string) => {
  const i = STATUS_ORDER.indexOf(s);
  return i < 0 ? STATUS_ORDER.length : i;
};
const TYPE_ORDER: string[] = PLAN_TYPES.map((t) => t.key);

/** A comparable value for a row, or null when the row has nothing there. */
function sortValue(r: PurchaserPlanRow, key: PlanSortKey): string | number | null {
  switch (key) {
    case "mrfStatus": return statusRank(r.mrfStatus);
    case "type": return r.type ? TYPE_ORDER.indexOf(r.type) : null;
    case "orderedDate": return r.orderedDate;
    case "purchaseDue": return r.purchaseDue;
    case "clientDue": return r.clientDue;
    case "orderNo": return r.orderNo;
    case "accountHolder": return r.accountHolder && r.accountHolder !== "—" ? r.accountHolder : null;
    case "poNumber": return r.poNumbers[0]?.number ?? null;
    case "mrfNo": return r.mrfNo;
  }
}

const compare = (a: string | number, b: string | number): number =>
  typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

/**
 * Sort by one key, either way. **Blanks always go last** whichever way — a row
 * with no due date is not "the earliest" or "the latest", it is undecided, and
 * flipping the direction should not drag the undecided rows to the top. Ties
 * fall back to purchase due date, then MRF no., so the order is stable.
 */
export function sortPlanBy(rows: readonly PurchaserPlanRow[], key: PlanSortKey, dir: SortDir): PurchaserPlanRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    // Sorting by Purchase due date means "what's coming due" — the owner: "show
    // the 10 soon to due rows". A purchase already RECEIVED into stock is no
    // longer due at all, however old its date, so it goes after every row still
    // owed (overdue first, then soonest), in either direction; rows with no due
    // date stay last of all, as for every column.
    if (key === "purchaseDue") {
      const c = dueClass(a) - dueClass(b);
      if (c !== 0) return c;
    }
    const av = sortValue(a, key), bv = sortValue(b, key);
    if ((av == null) !== (bv == null)) return av == null ? 1 : -1;
    if (av != null && bv != null) {
      const c = compare(av, bv);
      if (c !== 0) return c * sign;
    }
    const ad = a.purchaseDue ?? "9999", bd = b.purchaseDue ?? "9999";
    if (ad !== bd) return ad < bd ? -1 : 1;
    return compare(a.mrfNo, b.mrfNo);
  });
}

/** 0 = still owed, with a due date · 1 = already received · 2 = no due date. */
const dueClass = (r: PurchaserPlanRow): number => (!r.purchaseDue ? 2 : r.receivedOn ? 1 : 0);

export interface PlanGroup {
  key: string;
  label: string;
  rows: PurchaserPlanRow[];
}

const monthLabel = (ymd: string) => {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-PH", { timeZone: "UTC", month: "long", year: "numeric" });
};

/** Which group a row falls in, and the heading it goes under. Dates group by month. */
function groupOf(r: PurchaserPlanRow, key: Exclude<PlanGroupKey, "none">): { key: string; label: string; rank: string | number | null } {
  switch (key) {
    case "orderedDate":
    case "purchaseDue":
    case "clientDue": {
      const d = r[key];
      return d ? { key: d.slice(0, 7), label: monthLabel(d), rank: d.slice(0, 7) } : { key: "~none", label: "No date", rank: null };
    }
    case "mrfStatus": return { key: r.mrfStatus, label: r.mrfStatus, rank: statusRank(r.mrfStatus) };
    case "type": return r.type ? { key: r.type, label: planTypeLabel(r.type), rank: TYPE_ORDER.indexOf(r.type) } : { key: "~none", label: "No type yet", rank: null };
    case "orderNo": return { key: r.orderNo, label: r.orderNo, rank: r.orderNo };
    case "accountHolder": {
      const v = r.accountHolder && r.accountHolder !== "—" ? r.accountHolder : null;
      return v ? { key: v, label: v, rank: v } : { key: "~none", label: "No account holder", rank: null };
    }
    case "poNumber": {
      // An MRF on two POs groups under both numbers together, as its cell reads.
      const v = r.poNumbers.map((p) => p.number).join(" / ");
      return v ? { key: v, label: v, rank: r.poNumbers[0].number } : { key: "~none", label: "No PO yet", rank: null };
    }
  }
}

/**
 * Group, then sort inside each group. The groups follow the same direction as
 * the sort when grouping and sorting on the same column, and run ascending
 * otherwise; the "no value" group always comes last.
 */
export function groupPlan(
  rows: readonly PurchaserPlanRow[],
  groupKey: PlanGroupKey,
  sortKey: PlanSortKey,
  dir: SortDir,
): PlanGroup[] {
  const sorted = sortPlanBy(rows, sortKey, dir);
  if (groupKey === "none") return [{ key: "all", label: "", rows: sorted }];
  const groups = new Map<string, PlanGroup & { rank: string | number | null }>();
  for (const r of sorted) {
    const g = groupOf(r, groupKey);
    const existing = groups.get(g.key);
    if (existing) existing.rows.push(r);
    else groups.set(g.key, { key: g.key, label: g.label, rank: g.rank, rows: [r] });
  }
  const sign = groupKey === sortKey && dir === "desc" ? -1 : 1;
  return [...groups.values()]
    .sort((a, b) => {
      if ((a.rank == null) !== (b.rank == null)) return a.rank == null ? 1 : -1;
      return a.rank == null || b.rank == null ? 0 : compare(a.rank, b.rank) * sign;
    })
    .map(({ key, label, rows: rs }) => ({ key, label, rows: rs }));
}

// --- Rejected / Cancelled: their own box ------------------------------------------

/**
 * The owner: *"in Purchase Plan, make a separate box for Rejected/Cancelled
 * MRF."* Two ways an MRF ends up there:
 *
 *  - the **MRF itself was cancelled** (by its requestor, or an admin) — these
 *    used to be left off the plan altogether;
 *  - **every purchase request raised from it was rejected or cancelled** in
 *    Purchasing — these used to sit in the main table reading "Rejected".
 *
 * Neither is work anyone is still doing, so the main table no longer carries
 * them; the box keeps them in sight, with who closed them, when, and why.
 */
export type ClosedOutcome = "MRF cancelled" | "Purchase rejected" | "Purchase cancelled";

const isOffChain = (s: string) => s === "REJECTED" || s === "CANCELLED";

/** Every purchase request on this MRF was rejected or cancelled (and there was at least one). */
export const allPurchasesClosed = (prStatuses: readonly string[]): boolean =>
  prStatuses.length > 0 && prStatuses.every(isOffChain);

/**
 * On the main plan? Open (not completed, not cancelled) AND not closed out in
 * Purchasing. The one rule both the page and the dashboard tile count by, so
 * the tile's number is the table's row count.
 */
export const isPlanActive = (mrfStatus: string, prStatuses: readonly string[]): boolean =>
  isPlanOpenMrf(mrfStatus) && !allPurchasesClosed(prStatuses);

export interface ClosedInfo {
  outcome: ClosedOutcome;
  byName: string | null;
  /** ISO instant, or null when nothing was recorded. */
  at: string | null;
  note: string | null;
}

const iso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString() : null;
};

/**
 * Why this MRF belongs in the Rejected / Cancelled box — or null if it doesn't.
 * A completed MRF never does: it finished, it wasn't called off.
 */
export function closedInfo(
  mrf: { status: string; handledByName?: string | null; handledAt?: string | null },
  prs: readonly PlanPr[],
): ClosedInfo | null {
  if (mrf.status === "cancelled") {
    return { outcome: "MRF cancelled", byName: mrf.handledByName ?? null, at: iso(mrf.handledAt), note: null };
  }
  if (mrf.status === "completed") return null;
  if (!allPurchasesClosed(prs.map((p) => p.status))) return null;
  // Several requests, all closed: the most recent decision speaks for the MRF.
  const last = [...prs].sort((a, b) => (iso(b.decidedAt) ?? "").localeCompare(iso(a.decidedAt) ?? ""))[0];
  return {
    outcome: last.status === "REJECTED" ? "Purchase rejected" : "Purchase cancelled",
    byName: last.decidedByName ?? null,
    at: iso(last.decidedAt),
    note: (last.decisionNote ?? "").trim() || null,
  };
}

export interface ClosedPlanRow extends ClosedInfo {
  key: string;
  quotationId: string;
  mrfId: string;
  orderNo: string;
  orderHref: string;
  mrfHref: string;
  orderedDate: string | null;
  accountHolder: string;
  /** Any PO that was raised before the purchase was rejected / cancelled. */
  poNumbers: PlanPo[];
  mrfNo: string;
}

/** Most recently closed first; anything without a date last. */
export function sortClosedRows(rows: ClosedPlanRow[]): ClosedPlanRow[] {
  return [...rows].sort((a, b) => {
    if (!!a.at !== !!b.at) return a.at ? -1 : 1;
    if (a.at && b.at && a.at !== b.at) return a.at < b.at ? 1 : -1;
    return a.mrfNo.localeCompare(b.mrfNo, undefined, { numeric: true });
  });
}
