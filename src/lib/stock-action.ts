/**
 * Stock actions proposed on the Inventory page, and the sign-offs each needs.
 *
 * ONE chain, for **every** kind — Edit, Adjust, Reserve and Transfer alike — and
 * its length depends on WHO RAISED IT:
 *
 *   Warehouse raises it  →  Purchaser approves  →  Admin / Payment Approver
 *   Purchaser raises it  →  Admin / Payment Approver          (no Warehouse step)
 *   Admin / PA raises it →  applies at once     (they are the final approver)
 *
 * The middle line is the owner's *"remove the warehouse in approval stage"*: a
 * Purchaser's own request used to sit waiting for a Warehouseman who had nothing
 * to add to it. The last line matches Products, where a price owner's save has
 * always written straight through.
 *
 * It first ran on EDIT only, on the reading that the instruction was about the
 * edit panel. It was not, and the owner found it the direct way: a Warehouse
 * ADJUST *"stops after the purchaser approves"*, because that kind still ended
 * on the old two-party handshake and applied itself — which also explains why
 * nothing then reached the Admin / Payment Approver to notify them. A request is
 * a request whatever it changes.
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
  /** The price owner's final sign-off. */
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

/**
 * The signature this action is waiting for, or `null` when every one it needs is
 * in. One function decides the whole chain — the propose, the approve, the
 * Inventory card and the dashboard task list all read it, so none of them can
 * disagree about whose turn it is, and no kind can quietly finish early.
 *
 * `proposedRole` is the slot the proposer filled by proposing, and it is the
 * only thing that varies the chain. `kind` is deliberately NOT a parameter any
 * more: every kind ends at the price owner, and the last version's per-kind
 * shortcuts are exactly what let a Warehouse adjustment apply itself at the
 * Purchaser's click.
 *
 * A legacy row saying "admin" takes the long chain, which is the safe way to be
 * wrong. Rows already carrying both older signatures resolve to "approver" and
 * simply wait for the one that was never asked for.
 */
export function nextStockActionSlot(
  proposedRole: string,
  warehouseAt: Date | string | null,
  purchaserAt: Date | string | null,
  approverAt: Date | string | null,
): StockSlot | null {
  if (proposedRole === "approver") return null; // the final approver raised it
  if (proposedRole !== "purchaser" && purchaserAt == null) return "purchaser";
  return approverAt == null ? "approver" : null;
}

/** Every signature in? */
export function stockActionComplete(
  proposedRole: string,
  warehouseAt: Date | string | null,
  purchaserAt: Date | string | null,
  approverAt: Date | string | null,
): boolean {
  return nextStockActionSlot(proposedRole, warehouseAt, purchaserAt, approverAt) === null;
}

export const STOCK_ACTION_LABEL: Record<StockActionKind, string> = {
  EDIT: "Edit item",
  ADJUST: "Stock adjustment",
  RESERVE: "Reservation",
  TRANSFER: "Stock transfer",
};

