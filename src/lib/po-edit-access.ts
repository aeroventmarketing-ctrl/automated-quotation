/**
 * Who may edit a purchase order — its supplier, terms, EWT, remarks and its
 * lines (add, change, delete) — and when.
 *
 * The owner: *"allow purchaser to edit purchase order, delete and modify rows in
 * purchase order in Purchasing Pending and Purchasing Approved Tab."* Until then
 * the Payment Approver's approval of the PO locked it to admins. Now the
 * Purchaser keeps editing through both tabs — up to the voucher being SIGNED,
 * which is when the request moves to Budgeted (`isBudgetCommitted`). An admin's
 * reach is unchanged.
 *
 * Pure and client-safe: the PO cards and the server actions read the same rule.
 */
import { prMainIndex, type PRStatus } from "@/lib/purchasing";

/** Purchasing's Pending and Approved tabs: PENDING_APPROVAL, APPROVED, VOUCHER_READY. */
export function inPendingOrApprovedTab(status: PRStatus | string): boolean {
  const i = prMainIndex(status as PRStatus);
  return i >= 0 && i < prMainIndex("VOUCHER_SIGNED");
}

/**
 * A single request's PO. The Purchaser: in the Pending / Approved tabs, or any
 * time before the Approver has approved the PO (a request that never takes that
 * approval — one linked to an order — keeps the reach it always had). An admin:
 * always.
 */
export function canEditSinglePo(o: { admin: boolean; purchaser: boolean; status: PRStatus | string; poApproved: boolean }): boolean {
  if (o.admin) return true;
  if (!o.purchaser) return false;
  return !o.poApproved || inPendingOrApprovedTab(o.status);
}

/** A combined PO: only before the voucher is signed, for the Purchaser and an admin alike. */
export function canEditCombinedPo(o: { admin: boolean; purchaser: boolean; status: PRStatus | string }): boolean {
  return (o.admin || o.purchaser) && inPendingOrApprovedTab(o.status);
}

// --- An amount change after the voucher is prepared ------------------------------

/**
 * The owner, offered it after the Purchaser was allowed to edit through the
 * Approved tab: *"Please proceed with this"* — **an edit that changes a PO's
 * amount at Voucher ready sends it back to the Payment Approver.** By then
 * Accounting has prepared the voucher and the checks from the old amount, and
 * the next step is the Payment Approver signing them; signing a voucher that no
 * longer matches its PO is exactly what this stops.
 *
 * Sent back means: the Payment Approver's PO approval and the prepared voucher
 * are cleared, and the request returns to the Pending tab awaiting the Payment
 * Approver's **Approve purchase** — then Accounting prepares the voucher afresh
 * and the chain runs on as before. A department / MRF requisition goes back to
 * APPROVED without `approve_po` (the Plant Manager's MRF approval stands); any
 * other request, whose one approval IS the Payment Approver's, goes back to
 * PENDING_APPROVAL. The send-back itself is stamped in the chain log
 * (`sent_back`: who, as what, when, from and to which amount).
 *
 * An edit that leaves the amount alone (a remark, the terms, a description)
 * sends nothing back. It applies to whoever edits, an admin included: the
 * voucher no longer matches either way.
 */
export const SENT_BACK_KEY = "sent_back";

/** Total and net (after EWT), to the centavo — the figures the voucher is drawn for. */
export interface PoAmount {
  total: number;
  net: number;
}

export const poAmountChanged = (before: PoAmount, after: PoAmount): boolean =>
  Math.abs(before.total - after.total) >= 0.005 || Math.abs(before.net - after.net) >= 0.005;

/** Does saving this edit send the PO back to the Payment Approver? */
export const sendsBackForApproval = (status: PRStatus | string, before: PoAmount, after: PoAmount): boolean =>
  status === "VOUCHER_READY" && poAmountChanged(before, after);

export interface SentBack {
  byName: string;
  role: string;
  at: string;
  /** The PO's net before and after the edit. */
  from: number;
  to: number;
}

/**
 * The fields that send one request back. `isDept` is `isDeptRequisition(pr)`.
 * Returned as plain values so the server actions can hand them to Prisma.
 */
export function sentBackFields(
  pr: { chainLog: unknown; isDept: boolean },
  stamp: SentBack,
): {
  status: "APPROVED" | "PENDING_APPROVAL";
  chainLog: Record<string, unknown>;
  voucherByName: null;
  voucherAt: null;
  voucherRef: null;
  decidedById?: null;
  decidedByName?: null;
  decidedAt?: null;
} {
  const log = { ...((pr.chainLog && typeof pr.chainLog === "object" ? pr.chainLog : {}) as Record<string, unknown>) };
  delete log.approve_po;
  log[SENT_BACK_KEY] = { ...stamp };
  const base = { chainLog: log, voucherByName: null, voucherAt: null, voucherRef: null } as const;
  return pr.isDept
    ? { status: "APPROVED", ...base }
    : { status: "PENDING_APPROVAL", ...base, decidedById: null, decidedByName: null, decidedAt: null };
}

/** The stamp, read back for the card's trail — or null. */
export function readSentBack(chainLog: unknown): SentBack | null {
  const e = (chainLog && typeof chainLog === "object" ? (chainLog as Record<string, unknown>)[SENT_BACK_KEY] : null) as Record<string, unknown> | null;
  if (!e || typeof e !== "object" || typeof e.byName !== "string") return null;
  return {
    byName: e.byName,
    role: typeof e.role === "string" ? e.role : "",
    at: typeof e.at === "string" ? e.at : "",
    from: Number(e.from) || 0,
    to: Number(e.to) || 0,
  };
}
