/**
 * The photo of the CHECK issued for a PO's voucher.
 *
 * Owner's rules, in their words:
 *
 * > *"I would like accounting role to attach or upload picture of check in this
 * > location (right side of Print PO & 2307 button) for future reference."*
 *
 * > *"Should attaching a check be required before 'Voucher & Check Signed'? — It
 * > is required, but not a gate. Admin should be notified if not attached. Check
 * > is required for suppliers that give terms to us."*
 *
 * > *"Who can upload? — Accounting, Payment Approver and Admin."*
 *
 * So: **required, never blocking.** Nothing here refuses a step; the only
 * consequence of a missing check is that the PO is flagged and the people who can
 * fix it are told. A gate here would stop a supplier being paid because a photo
 * hadn't been taken yet, which is worse than the thing it prevents.
 *
 * Rides in `PurchaseRequest.voucherCheckDocs` (a JSON array). For a combined PO it
 * attaches to the anchor request — one check is written per PO, not per member
 * request.
 */
import type { PRStatus } from "@/lib/purchasing";
import { prMainIndex } from "@/lib/purchasing";

/** One uploaded check photo. `SaleDoc` plus who attached it. */
export interface CheckDoc {
  path: string; // storage path under `purchases/<prId>/…`
  name: string; // original file name
  uploadedAt: string; // ISO
  uploadedByName: string;
}

export function coerceCheckDoc(v: unknown): CheckDoc | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.path !== "string" || !o.path) return null;
  return {
    path: o.path,
    name: typeof o.name === "string" && o.name ? o.name : "check",
    uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : "",
    uploadedByName: typeof o.uploadedByName === "string" ? o.uploadedByName : "",
  };
}

export function coerceCheckDocs(v: unknown): CheckDoc[] {
  if (!Array.isArray(v)) return [];
  return v.map(coerceCheckDoc).filter((d): d is CheckDoc => d !== null);
}

/**
 * Who may attach or remove a check photo: **Accounting, the Payment Approver, and
 * an admin** — the owner's answer, exactly. The Purchaser is not on the list: they
 * carry the cash, they do not write the check.
 */
export function canAttachCheck(opts: { admin: boolean; workflowRoles: string[] }): boolean {
  return opts.admin || opts.workflowRoles.includes("accounting") || opts.workflowRoles.includes("payment_approver");
}

/**
 * The status from which a check is expected to exist. The check is written as
 * part of *Voucher & Check Prepared* and signed at *Voucher & Check Signed*, so a
 * PO that has reached VOUCHER_SIGNED should have its photo.
 *
 * Before that there is nothing to photograph, and flagging it would train everyone
 * to ignore the flag.
 */
export const CHECK_EXPECTED_FROM: PRStatus = "VOUCHER_SIGNED";

/**
 * Is a check photo expected on this PO at all?
 *
 * Two conditions, both the owner's: the supplier **gives us terms** (we pay later,
 * by check — a cash purchase has no check to photograph), and the PO has reached
 * the point where the check exists. A cancelled or rejected PO is never chased.
 */
export function checkExpected(opts: { supplierGivesTerms: boolean; status: PRStatus }): boolean {
  if (!opts.supplierGivesTerms) return false;
  if (opts.status === "CANCELLED" || opts.status === "REJECTED") return false;
  return prMainIndex(opts.status) >= prMainIndex(CHECK_EXPECTED_FROM);
}

/** Expected, and not there — the condition the amber badge and the notification key on. */
export function checkMissing(opts: { supplierGivesTerms: boolean; status: PRStatus; docs: CheckDoc[] }): boolean {
  return checkExpected(opts) && opts.docs.length === 0;
}
