/**
 * Double-handshake stock actions. An Edit / Adjust / Reserve / Transfer proposed
 * on the Inventory page is held pending and only applied once BOTH a Warehouseman
 * and a Purchaser approve it. Types + serialisable view helpers.
 *
 * **EDIT needs a third sign-off** — the Admin / Payment Approver who owns the
 * catalogue price (lib/price-authority), because an edit carries the item's unit
 * cost and selling price. Adjust / Reserve / Transfer move quantities, not money,
 * and are unchanged.
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
  /** Whether the viewer may fill each still-open handshake slot. */
  canApproveWarehouse: boolean;
  canApprovePurchaser: boolean;
  canApproveOwner: boolean;
}

/** Does this kind of action wait on the catalogue price owner? EDIT only. */
export function needsPriceOwner(kind: StockActionKind): boolean {
  return kind === "EDIT";
}

/**
 * Which sign-offs a pending action still needs before it applies. Reserve needs
 * only the Warehouseman (it earmarks stock — no on-hand or value change); Edit
 * needs the Warehouseman, the Purchaser AND the price owner; everything else
 * needs the Warehouseman and the Purchaser.
 */
export function stockActionComplete(
  kind: StockActionKind,
  warehouseAt: Date | string | null,
  purchaserAt: Date | string | null,
  approverAt: Date | string | null,
): boolean {
  if (kind === "RESERVE") return warehouseAt != null;
  if (warehouseAt == null || purchaserAt == null) return false;
  return !needsPriceOwner(kind) || approverAt != null;
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
