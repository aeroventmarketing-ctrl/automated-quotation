/**
 * Goods arrived before the paperwork — the Warehouseman receives early.
 *
 * The owner: *"Is there a way where warehouseman can bypass all approvers and
 * press receive and add to stock button?"* — chose **"confirm the delivery early;
 * the rest of the PO steps carry on"**, with a **Delivered** shortcut on the
 * Inventory page:
 *
 *  - From **Cash & Check Released** until the Plant Manager's final approval, the
 *    Warehouseman (or an admin) may press **Goods arrived — Receive now** on the
 *    PO. It is the ordinary receive panel: the stock held since cash release
 *    becomes usable, anything not added then goes in now.
 *  - The PO does not jump ahead. Hand-off, logistics, Item bought, the checks and
 *    the voucher reconciliation still happen; nobody's sign-off is faked.
 *  - When the Plant Manager gives final approval, the PO **completes on its own**
 *    — the stock was received already, so there is no second Receive to press.
 *
 * The stamp rides in `chainLog.early_receive`. It is not a chain step, so the
 * admin roll-back (which clears step stamps) leaves it alone: goods that arrived
 * stay arrived, and Cash & Check Released pressed again must not add them twice.
 */
import { PR_MAIN_ORDER, type PRStatus } from "@/lib/purchasing";

export const EARLY_RECEIVE_KEY = "early_receive";

export interface EarlyReceiveStamp {
  byName: string;
  at: string;
}

export function readEarlyReceive(chainLog: unknown): EarlyReceiveStamp | null {
  if (!chainLog || typeof chainLog !== "object") return null;
  const e = (chainLog as Record<string, unknown>)[EARLY_RECEIVE_KEY];
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  return typeof o.byName === "string" && typeof o.at === "string" ? { byName: o.byName, at: o.at } : null;
}

const idx = (s: PRStatus) => PR_MAIN_ORDER.indexOf(s);

/**
 * Cash & Check Released … Warehouseman received & approved. At Plant Manager
 * approved the ordinary Receive is already open, so the early one isn't offered.
 */
export function inEarlyReceiveWindow(status: string): boolean {
  const i = idx(status as PRStatus);
  return i >= idx("CASH_RELEASED") && i < idx("PLANT_APPROVED");
}

/** An Office bought-in requisition linked to an order goes to the client — never into stock. */
export function goesToClientNotStock(pr: { kind?: string | null; dept: string | null; quotationId: string | null }): boolean {
  return pr.kind === "department" && pr.dept === "office" && !!pr.quotationId;
}

/** May this request be received early, by someone who may receive? */
export function canReceiveEarly(
  pr: { status: string; chainLog?: unknown; kind?: string | null; dept: string | null; quotationId: string | null },
  mayReceive: boolean,
): boolean {
  return mayReceive && inEarlyReceiveWindow(pr.status) && !readEarlyReceive(pr.chainLog) && !goesToClientNotStock(pr);
}
