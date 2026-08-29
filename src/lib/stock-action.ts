/**
 * Stock actions proposed on the Inventory page, and the sign-offs each needs.
 *
 * **Adjust / Reserve / Transfer** keep the original handshake: Reserve needs the
 * Warehouseman alone (it earmarks stock — no on-hand or value change), the other
 * two need the Warehouseman and the Purchaser.
 *
 * **Edit** carries the unit cost and selling price, so it runs the owner's
 * approval chain instead, and the chain depends on WHO RAISED IT:
 *
 *   Warehouse raises it  →  Purchaser approves  →  Admin / Payment Approver
 *   Purchaser raises it  →  Admin / Payment Approver          (no Warehouse step)
 *   Admin / PA raises it →  applies at once     (they are the final approver)
 *
 * The middle line is the owner's *"remove the warehouse in approval stage"*: a
 * Purchaser's own edit used to sit waiting for a Warehouseman who had nothing to
 * add to it. The last line matches Products, where a price owner's save has
 * always written straight through.
 */
import type { StockActionKind, StockActionStatus } from "@prisma/client";
import { coerceStockDoc, type StockDoc } from "@/lib/stock-transfer";

export { coerceStockDoc };
export type { StockDoc };

export interface EditPayload {
  category: string | null;
  location: string | null;
  reorderLevel: number;
  unitCost: number;
  sellPrice: number;
}
export interface AdjustPayload {
  kind: "RECEIPT" | "ISSUE" | "ADJUSTMENT";
  qty: number;
  reason: string | null;
}
export interface ReservePayload {
  qty: number;
  forRef: string;
  note: string | null;
  validUntil: string | null; // ISO date the reservation is valid until (optional)
}
export interface TransferPayload {
  qty: number;
  toLocation: string;
  note: string | null;
  proof: StockDoc | null;
}
export type StockActionPayload = EditPayload | AdjustPayload | ReservePayload | TransferPayload;

/** The row shape the Inventory + dashboards render. */
export interface StockActionView {
  id: string;
  stockItemId: string;
  itemName: string;
  kind: StockActionKind;
  kindLabel: string;
  summary: string;
  status: StockActionStatus;
  proof: StockDoc | null; // transfer proof (eye-view), else null
  proposedByName: string;
  proposedAt: string;
  warehouseByName: string | null;
  purchaserByName: string | null;
  /** The price owner's sign-off — EDIT only; always null on the other kinds. */
  approverByName: string | null;
  /** Whose signature the action is waiting for, or null when it is complete. */
  nextSlot: StockSlot | null;
  /** Whether THIS viewer is the one who may sign that next slot. */
  canApproveNext: boolean;
  /** Whether the viewer may reject it — any party to the chain, at any point. */
  canReject: boolean;
}

/** The three signatures an action can need, in the order they are taken. */
export type StockSlot = "warehouse" | "purchaser" | "approver";

export const STOCK_SLOT_LABEL: Record<StockSlot, string> = {
  warehouse: "Warehouseman",
  purchaser: "Purchaser",
  approver: "Admin / Payment Approver",
};

/** Does this kind of action wait on the catalogue price owner? EDIT only. */
export function needsPriceOwner(kind: StockActionKind): boolean {
  return kind === "EDIT";
}

/**
 * The signature this action is waiting for, or `null` when every one it needs is
 * in. One function decides the whole chain — the propose, the approve, the
 * Inventory card and the dashboard task list all read it, so none of them can
 * disagree about whose turn it is.
 *
 * `proposedRole` is the slot the proposer filled by proposing, which is what
 * makes an Edit's chain depend on who raised it. A legacy row saying "admin"
 * (nobody writes that for an Edit any more) takes the long chain, which is the
 * safe way to be wrong.
 */
export function nextStockActionSlot(
  kind: StockActionKind,
  proposedRole: string,
  warehouseAt: Date | string | null,
  purchaserAt: Date | string | null,
  approverAt: Date | string | null,
): StockSlot | null {
  if (kind === "EDIT") {
    if (proposedRole === "approver") return null; // the final approver raised it
    if (proposedRole !== "purchaser" && purchaserAt == null) return "purchaser";
    return approverAt == null ? "approver" : null;
  }
  if (kind === "RESERVE") return warehouseAt == null ? "warehouse" : null;
  if (warehouseAt == null) return "warehouse";
  return purchaserAt == null ? "purchaser" : null;
}

/** Every signature in? */
export function stockActionComplete(
  kind: StockActionKind,
  proposedRole: string,
  warehouseAt: Date | string | null,
  purchaserAt: Date | string | null,
  approverAt: Date | string | null,
): boolean {
  return nextStockActionSlot(kind, proposedRole, warehouseAt, purchaserAt, approverAt) === null;
}

export const STOCK_ACTION_LABEL: Record<StockActionKind, string> = {
  EDIT: "Edit item",
  ADJUST: "Stock adjustment",
  RESERVE: "Reservation",
  TRANSFER: "Stock transfer",
};

/** Both handshakes complete? */
export function bothApproved(a: { warehouseAt: Date | null; purchaserAt: Date | null }): boolean {
  return a.warehouseAt != null && a.purchaserAt != null;
}
